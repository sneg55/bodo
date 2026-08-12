// `Generate Download`: resolve the selection, then queue the "your file is ready" mail.
//
// The reference makes this asynchronous ("You will receive an email once the file is ready
// to download"), and the outbox is how this app already sends asynchronously, so nothing new
// is invented here: `enqueueEmails` writes one row, the cron sweep
// (/api/cron/reminders -> drainOutbox) sends it, and the row carries the download link.
//
// EXACTLY ONCE is `claimOnce`, the ClaimGuard Durable Object, and not the two mechanisms
// that look like they would do (see src/utils/cf.ts): KV is eventually consistent with no
// compare-and-swap so two clicks can both win, and an Airtable status column has no
// transaction. The claim is keyed on the request's own id plus the minute, so:
//
//   - two concurrent `Generate Download` presses of the same selection produce one email,
//     because only one of them holds the claim;
//   - the same selection asked for again later is a new minute, so it is a new request and
//     sends again, which is what somebody who deleted the first mail wants.
//
// `enqueueEmails` keys on exactly the same string, which is the belt to the claim's braces:
// the claim closes the concurrent window, the idempotency key closes the sequential one.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { plannedArchive } from '@/features/bundle/archive'
import { bundleReadyEmail } from '@/features/bundle/email'
import { type BundleRequest, bundleDownloadPath, bundleRequestId } from '@/features/bundle/link'
import { loadBundleCandidates } from '@/features/bundle/reads'
import { MAX_BUNDLE_SESSIONS } from '@/features/bundle/selection'
import { type SubmissionScope, scopeCopy } from '@/features/review/submission-scope'
import { readTeamMembers } from '@/features/team/reads'
import { enqueueEmails } from '@/services/airtable/mutations-outbox'
import { getEvent } from '@/services/airtable/queries'
import { claimOnce } from '@/utils/cf'
import { appUrl } from '@/utils/env'

/** As long as one press takes to finish. Short enough that a genuine retry is not blocked. */
const CLAIM_MS = 60_000

export type BundleRequestOutcome = {
  readonly fileCount: number
  readonly totalBytes: number
  readonly sessionCount: number
  /** Where the mail went. Echoed so the toast can name it rather than saying "an email". */
  readonly toEmail: string
  /** True when another press of the same selection had already queued this minute's mail. */
  readonly alreadyQueued: boolean
}

/** The acting user's address, from the event's own team rows. */
async function actingEmail(eventId: string, userId: string): Promise<string> {
  const email = (await readTeamMembers(eventId)).find((member) => member.userId === userId)?.email
  if (email === undefined || email.trim() === '') {
    // Reachable: `teamRows` keeps a membership whose AdminUsers row was deleted, with a
    // blank email. There is nowhere to send, and silently queueing a row with an empty
    // recipient would fail five times in the drain with no explanation on this screen.
    throw new AppError(
      ErrorIds.AUTH_UNKNOWN_ADMIN,
      'your account has no email address on this event, so there is nowhere to send the file',
      { eventId, userId },
    )
  }
  return email
}

/**
 * All three refusals name the rows of the surface the organizer is looking at.
 *
 * They said "abstracts" unconditionally until 2026-08-10, and the same dialog opens from
 * Abstracts, Sessions and View All, so an organizer on Sessions who left the modal open while
 * the selection changed underneath them got a toast about abstracts. The dialog's own inline
 * messages read the same `scopeCopy(scope).plural`, so the two halves of one refusal cannot
 * disagree about what was being downloaded.
 */
function scopeFailure(problem: 'empty' | 'too-many', noun: string): AppError {
  if (problem === 'empty') {
    return new AppError(
      ErrorIds.SUB_VALIDATION_FAIL,
      `Select the ${noun} whose files you want before generating a download.`,
      { problem },
    )
  }
  return new AppError(
    ErrorIds.SUB_VALIDATION_FAIL,
    `A download covers at most ${String(MAX_BUNDLE_SESSIONS)} ${noun} at a time.`,
    { problem },
  )
}

/**
 * Queue the download.
 *
 * Authorizes here, in the function the action calls, and not in the layout: a layout is not
 * a security boundary. `reviewer` rather than `admin`, matching the CSV export on the same
 * menu, because both hand over data this role already reads on the table.
 */
export async function requestFileBundle(
  request: BundleRequest,
  nowMs: number,
  /**
   * Which of the three submission surfaces asked. Only the refusal wording depends on it, so
   * it is a separate argument rather than a field on `BundleRequest`: that type is also parsed
   * back out of the download URL and feeds `bundleRequestId`, and adding a member would put a
   * word of copy inside the claim key.
   */
  surface: SubmissionScope = 'abstracts',
): Promise<BundleRequestOutcome> {
  const { userId } = await requireEventRole(request.eventId, 'reviewer')
  const noun = scopeCopy(surface).plural

  const candidates = await loadBundleCandidates({
    eventId: request.eventId,
    checkedSessionIds: request.sessionIds,
    deselectedFileIds: request.deselectedFileIds,
  })
  if (candidates.scope.problem !== undefined) throw scopeFailure(candidates.scope.problem, noun)
  if (candidates.files.length === 0) {
    throw new AppError(
      ErrorIds.DATA_RECORD_NOT_FOUND,
      `The selected ${noun} have no files attached.`,
      { eventId: request.eventId },
    )
  }

  const [event, toEmail] = await Promise.all([
    getEvent(request.eventId),
    actingEmail(request.eventId, userId),
  ])

  const { totalBytes } = plannedArchive(candidates.files, request.grouping)
  const outcome = {
    fileCount: candidates.files.length,
    totalBytes,
    sessionCount: candidates.sessionCount,
    toEmail,
  }

  // Per minute, so a double click collapses and a deliberate retry does not. The same string is
  // the outbox key, so the two protections cover the same unit of work.
  //
  // `userId` is IN the key. Without it two organizers asking for the same selection in the same
  // minute shared one claim and one outbox row, so the second was told an email was on its way to
  // their address when nothing had been queued for them. They each asked, so they each get one.
  //
  // A NOT-GRANTED claim is not proof the work was done, which is why the enqueue runs either way.
  // The claim is taken before the outbox write, so a request that died in between left the claim
  // held with no row behind it, and every retry inside the TTL was answered "already queued"
  // while the email was gone for good. Running the enqueue on both paths repairs that, and it is
  // safe to do because `enqueueEmails` UPSERTS on `idempotencyKey` (mutations-outbox.ts): a row
  // that already exists is reported as skipped rather than written twice. The claim's remaining
  // job is to keep two concurrent callers from both doing the read-then-upsert.
  //
  // Not closed, and bounded rather than ignored: two presses that straddle a minute boundary get
  // two keys and therefore two identical emails. Fixing that needs a stored request identity
  // rather than a time bucket, and the time bucket is what makes a deliberate retry work at all.
  // Found by Codex review.
  const key = `bundle:${bundleRequestId(request)}:${userId}:${new Date(nowMs).toISOString().slice(0, 16)}`
  await claimOnce(key, crypto.randomUUID(), CLAIM_MS)

  const { queued } = await enqueueEmails(
    [
      {
        eventId: request.eventId,
        templateSource: 'system',
        idempotencyKey: key,
        toEmail,
        sendAt: new Date(nowMs).toISOString(),
        payload: {
          ...bundleReadyEmail({
            eventName: event.name,
            downloadUrl: `${appUrl()}${bundleDownloadPath(request)}`,
            fileCount: outcome.fileCount,
            totalBytes,
            sessionCount: outcome.sessionCount,
          }),
          attachIcs: false,
        },
      },
    ],
    'action',
  )

  return { ...outcome, alreadyQueued: queued === 0 }
}
