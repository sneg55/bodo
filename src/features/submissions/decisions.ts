'use server'

// The admin decision path: inline status edits, the two staging queues, and Notify.
//
// Every action begins with `requireEventRole(eventId, 'admin')`. That is not belt and
// braces on top of the layout guard, it is the only enforcement there is: BUILD_SPEC 4
// states that a layout is not a security boundary, that a Next app has several entry
// points, and that a Server Action is reachable without the layout ever rendering. A
// reviewer holds `reviewer` on the event, `roleSatisfies` ranks that below `admin`, and
// so a reviewer calling any of these gets AUTH_FORBIDDEN_ROLE. Which is the point: a
// reviewer scores, an organizer decides.
//
// Notify enqueues and returns. It does not send (BUILD_SPEC 5.3, and the long comment
// in decision-outbox.ts).

import { AppError, ErrorIds, isAppError } from '@/constants/errorIds'
import type { SubmissionStatus } from '@/constants/status'
import { requireEventRole } from '@/features/auth/wiring'
import { TEMPLATE_KEYS } from '@/features/comms/template-keys'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { commitStatus } from '@/features/submissions/commit-status'
import { decisionAudience } from '@/features/submissions/decision-audience'
import { decisionOutboxRows, enqueueOutbox } from '@/features/submissions/decision-outbox'
import {
  assertTransition,
  canTransition,
  decisionOf,
  notifyTarget,
  type QueueDecision,
  queueTarget,
} from '@/features/submissions/transitions'
import { getEvent, listSubmissions } from '@/services/airtable/queries'
import { findEmailTemplate } from '@/services/airtable/reads-comms'
import type { RecordId, SubmissionWithParticipants } from '@/types/domain'
import { appUrl } from '@/utils/env'

/**
 * The submission as the cached list already has it. Read from the list rather than
 * per id: the list is one cached, tagged read the Abstracts page has just done, and a
 * bulk action over forty rows would otherwise be forty `getSubmission` calls against a
 * five-request-per-second budget (BUILD_SPEC 3.1).
 */
async function loadRows(
  eventId: RecordId,
  ids: readonly RecordId[],
): Promise<readonly SubmissionWithParticipants[]> {
  const wanted = new Set(ids)
  return (await listSubmissions(eventId)).filter((row) => wanted.has(row.id))
}

/**
 * Inline status chip edit. One row, one transition, validated.
 *
 * A jump from `pending` straight to `accepted` is refused here, and the reason is not
 * tidiness: `accepted` is what Notify writes, and Notify is what sends the email, so
 * that jump produces a speaker who is accepted and will never be told.
 */
export async function setStatusAction(input: {
  eventId: RecordId
  submissionId: RecordId
  status: SubmissionStatus
}): Promise<ActionResult<{ status: SubmissionStatus }>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const row = (await loadRows(input.eventId, [input.submissionId])).at(0)
    if (row === undefined) {
      return actionFailure(
        new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that submission is no longer on this event', {
          submissionId: input.submissionId,
        }),
      )
    }

    assertTransition(row.status, input.status, { submissionId: row.id })
    if (row.status !== input.status) {
      await commitStatus(input.eventId, row, input.status)
    }
    return actionOk({ status: input.status })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Bulk staging: move the selected rows into the Accept Queue or the Decline Queue.
 *
 * Rows the lifecycle will not move are skipped rather than failing the batch. An
 * organizer sweeping a track into the accept queue does not want the whole action
 * refused because one row in the selection was withdrawn last week.
 */
export async function queueDecisionAction(input: {
  eventId: RecordId
  submissionIds: readonly RecordId[]
  decision: QueueDecision
}): Promise<ActionResult<{ changed: number; skipped: number }>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    const target = queueTarget(input.decision)
    const rows = await loadRows(input.eventId, input.submissionIds)

    let changed = 0
    for (const row of rows) {
      // Checked, not asserted: see the note above on why one bad row is a skip.
      if (row.status === target || !canTransition(row.status, target)) continue
      await commitStatus(input.eventId, row, target)
      changed += 1
    }

    return actionOk({ changed, skipped: input.submissionIds.length - changed })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Notify: commit the staged rows, stamp `notifiedAt`, and write the EmailOutbox rows.
 *
 * `notifiedAt` is one instant for the whole batch, taken before the first write, and it
 * goes into every idempotency key. That is what makes pressing Notify twice produce one
 * email per recipient: the second press computes the same keys and the upsert merges.
 * Reading the clock per row would give each retry fresh keys and a second send.
 */
export async function notifyQueuedAction(input: {
  eventId: RecordId
  submissionIds: readonly RecordId[]
}): Promise<
  ActionResult<{
    changed: number
    skipped: number
    queuedEmails: number
    /** Codes of rows this press could not commit, so the admin can see WHICH failed. */
    failedCodes: readonly string[]
  }>
> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const notifiedAt = new Date().toISOString()
    const [event, rows] = await Promise.all([
      getEvent(input.eventId),
      loadRows(input.eventId, input.submissionIds),
    ])
    const portalUrl = `${appUrl()}/portal`

    let changed = 0
    let queuedEmails = 0
    let staged = 0
    const failedCodes: string[] = []

    for (const row of rows) {
      // `notifyTarget`, not `commitTarget`: a staged row is the ordinary case, and a row
      // already `accepted`/`declined` with no `notifiedAt` is CFP-14's re-entry case, a
      // decision made by jumping the status chip straight there instead of through
      // Notify. Either way `decisionOf` on the result tells us who gets mailed; a row
      // already notified, or one still sitting on `pending`/`draft`/`withdrawn`, yields
      // `undefined` and is a skip.
      const committed = notifyTarget(row.status, row.notifiedAt)
      const decision = committed === undefined ? undefined : decisionOf(committed)
      if (committed === undefined || decision === undefined) continue
      staged += 1

      // Guarded PER ROW, and this is the whole point rather than defensive habit. One
      // throw used to escape into the function-level catch, which abandoned every
      // remaining row: an organizer pressing Notify on forty accepted submissions got
      // the ones before the bad row committed and emailed, the ones after it silently
      // left staged, and an error message about a merge field that said nothing about
      // the batch having half-applied. Recovering meant working out by hand which rows
      // had landed. One unfixable row must cost exactly that row.
      const args = { row, committed, decision, event, input, notifiedAt, portalUrl }
      try {
        // Counted the moment the mail is queued, not after the status write. Those rows
        // exist and the drain will send them, so a status failure must not make the
        // report claim otherwise.
        queuedEmails += await enqueueDecisionMail(args)
        await commitDecision(args)
        changed += 1
      } catch (error) {
        console.error(`[notify] ${row.code} failed: ${describeError(error)}`)
        failedCodes.push(row.code)
      }
    }

    // `skipped` counts everything the organizer selected that this press did not commit
    // and did not fail on, which is why it is derived from the SELECTION and not from the
    // rows that loaded. `loadRows` drops ids it cannot find and collapses duplicates, so
    // measuring against `rows.length` quietly reported totals for a smaller selection
    // than the one on screen: select ten, have one deleted by a colleague mid-review, and
    // the counts add up to nine with nothing saying why.
    //
    // A row that was staged and then failed is in `failedCodes`, not here. Conflating
    // those is how a half-applied batch reads as a clean one.
    return actionOk({
      changed,
      skipped: input.submissionIds.length - staged,
      queuedEmails,
      failedCodes,
    })
  } catch (error) {
    return actionFailure(error)
  }
}

type NotifyArgs = {
  row: SubmissionWithParticipants
  committed: SubmissionStatus
  decision: QueueDecision
  event: { name: string; slug: string }
  input: { eventId: RecordId }
  notifiedAt: string
  portalUrl: string
}

/**
 * Step one: queue the mail. Returns how many rows were written.
 *
 * Enqueued BEFORE the status write. If the outbox write fails the row stays in its queue
 * and Notify can be pressed again; the other order would leave a row accepted with no
 * email and no record that one was ever owed.
 *
 * Kept separate from the status write so the caller can count what was queued even when
 * the status write then fails. Reporting `queuedEmails: 0` while two messages sit in the
 * outbox is how an organizer concludes nothing happened and goes looking for a different
 * problem.
 */
async function enqueueDecisionMail(args: NotifyArgs): Promise<number> {
  const { row, committed, decision, event, input, notifiedAt, portalUrl } = args

  assertTransition(row.status, committed, { submissionId: row.id })

  return await enqueueOutbox(
    decisionOutboxRows({
      // The organizer's own body for this decision, when they have written one, and
      // `undefined` when they have not, which is what makes the built-in body send.
      //
      // Read here rather than inside `decisionOutboxRows` so that stays a pure function, and
      // read through the CACHED, tagged list so a bulk Notify over forty rows costs one
      // Airtable request rather than forty (reads-comms.ts).
      template: await findEmailTemplate(
        input.eventId,
        decision === 'accept' ? TEMPLATE_KEYS.accepted : TEMPLATE_KEYS.rejected,
      ),
      eventId: input.eventId,
      eventName: event.name,
      eventSlug: event.slug,
      submissionId: row.id,
      submissionTitle: row.title,
      submissionCode: row.code,
      decision,
      recipients: recipientsFor(row, decision),
      notifiedAt,
      // The epoch being superseded, so a retry of THIS press computes the same keys and
      // the enqueue drops the duplicates. `decisionKey` explains why the new instant
      // cannot be used for that.
      keyEpoch: row.notifiedAt ?? 'first',
      portalUrl,
    }),
  )
}

/** Step two: commit the status, stamp `notifiedAt`, and tell the subscribers. */
async function commitDecision(args: NotifyArgs): Promise<void> {
  await commitStatus(args.input.eventId, args.row, args.committed, args.notifiedAt)
}

function describeError(error: unknown): string {
  if (isAppError(error)) return error.toLogLine()
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Accept tells everyone on the row; decline tells the submitter only.
 *
 * 5.3 says "each participant" for the acceptance email and names only the submitter for
 * the decline, and that asymmetry is right: a co-presenter needs their own invite and
 * their own tasks, but nobody needs to learn from us that a colleague's talk was cut.
 *
 * The filter is `decisionAudience`, shared with `decision-preview.ts`, and that sharing
 * is CFP-14's second half: this used to filter a decline by `isPrimary` while the
 * preview filtered it by `submitterId`, so whenever the primary presenter was not the
 * submitter, Preview correctly showed a submitter-only decline and the actual send
 * mailed nobody. See `decision-audience.ts` for the full account.
 */
function recipientsFor(row: SubmissionWithParticipants, decision: QueueDecision) {
  const participants = decisionAudience(row.participants, decision, row.submitterId)

  return participants.map((participant) => ({
    speakerId: participant.speakerId,
    email: participant.speaker.email,
    firstName: participant.speaker.firstName,
    lastName: participant.speaker.lastName,
  }))
}
