// Where the reminder sweep meets the data layer, the mail provider, and the claim guard.
//
// `reminders.ts` takes every one of those as an argument so the interleavings it exists to
// survive can be tested without a base, a Resend key, or a Durable Object. That
// indirection has to be resolved exactly once, and this is the file that does it, in the
// same shape as `features/auth/wiring.ts` and `features/portal/wiring.ts`. The route
// handler calls `runRemindersJob()` and knows none of it.

import { isAppError } from '@/constants/errorIds'
import { outstandingTaskRows } from '@/features/comms/outstanding-tasks'
import { TEMPLATE_KEYS } from '@/features/comms/template-keys'
import { drainDeps } from '@/features/jobs/drain-wiring'
import { runReminderSweep, type SweepResult } from '@/features/jobs/reminder-sweep'
import type { DraftForReminder, EnqueueCount, ReminderEnqueueDeps } from '@/features/jobs/reminders'
import {
  enqueueTaskDueReminders,
  type TaskReminderEnqueueDeps,
} from '@/features/jobs/task-reminders'
import { portalEventId } from '@/features/portal/event-scope'
import { acceptedSpeakerScopes } from '@/features/tasks/scope'
import { enqueueEmails } from '@/services/airtable/mutations-outbox'
import {
  getEvent,
  listForms,
  listSubmissions,
  listTaskAssignmentsForEvent,
} from '@/services/airtable/queries'
import { findEmailTemplate } from '@/services/airtable/reads-comms'
import { listEventsForSweep, sweepEventIds } from '@/services/airtable/reads-sweep'
import type { SubmissionWithParticipants } from '@/types/domain'
import { appUrl } from '@/utils/env'

/**
 * The draft owner, resolved from the cast already loaded with the submission.
 *
 * The submitter rather than the primary speaker: they are usually the same person, and
 * when they are not, the one who can act on "your draft is unsubmitted" is whoever is
 * writing it.
 */
function ownerOf(submission: SubmissionWithParticipants) {
  return (
    submission.participants.find(
      (participant) => participant.speakerId === submission.submitterId,
    ) ?? submission.participants.find((participant) => participant.isPrimary)
  )
}

/** Drafts with a resolvable recipient. One without is logged, not silently dropped. */
function draftsOf(submissions: readonly SubmissionWithParticipants[]): readonly DraftForReminder[] {
  return submissions.flatMap((submission) => {
    if (submission.status !== 'draft') return []

    const owner = ownerOf(submission)
    if (owner === undefined) {
      console.warn(`[cron] draft ${submission.id} has no participant to remind`)
      return []
    }

    return [
      {
        submissionId: submission.id,
        formId: submission.formId,
        status: submission.status,
        speakerId: owner.speakerId,
        toEmail: owner.speaker.email,
        firstName: owner.speaker.firstName,
        code: submission.code,
        title: submission.title,
      },
    ]
  })
}

function reminderDeps(eventId: string, nowMs: number): ReminderEnqueueDeps {
  return {
    eventId,
    portalUrl: `${appUrl()}/portal`,
    nowMs,
    loadEvent: () => getEvent(eventId),
    listForms: () => listForms(eventId),
    listDrafts: async () => draftsOf(await listSubmissions(eventId)),
    // The DAL's read-then-upsert enqueue, NOT a second one written here. It skips a key
    // the table already holds instead of upserting over it, which is the difference
    // between a repeated sweep writing nothing and a repeated sweep putting a row that
    // has already been sent back into the queue.
    enqueue: (rows) => enqueueEmails(rows, 'route'),
    // The organizer's own reminder body when they have written one. Cached and tagged, so a
    // sweep every five minutes does not cost an Airtable request every five minutes.
    loadTemplate: () => findEmailTemplate(eventId, TEMPLATE_KEYS.reminder),
  }
}

/**
 * The task-due sweep's one dependency. SPK-16.
 *
 * `outstandingTaskRows` is the SAME resolution the organizer's manual nudge uses, so the
 * scheduled reminder and the button chase the same people about the same to-dos. Three cached
 * reads, and all three are ones the Tasks page already makes, so this subscribes to nothing
 * the app was not reading anyway.
 */
function taskReminderDeps(eventId: string, nowMs: number): TaskReminderEnqueueDeps {
  return {
    eventId,
    portalUrl: `${appUrl()}/portal`,
    nowMs,
    load: async () => {
      const [event, items, submissions] = await Promise.all([
        getEvent(eventId),
        listTaskAssignmentsForEvent(eventId),
        listSubmissions(eventId),
      ])
      return {
        eventName: event.name,
        outstanding: outstandingTaskRows({
          scopes: acceptedSpeakerScopes(submissions),
          items,
          timeZone: event.timezone,
        }),
      }
    },
    enqueue: (rows) => enqueueEmails(rows, 'route'),
  }
}

/**
 * The task enqueue's failure is REPORTED, never thrown.
 *
 * The same rule note 2 in `reminders.ts` states for the draft half, applied to the third
 * half: this reads different tables from the other two and fails for different reasons, so a
 * rate-limited assignments read must not strand acceptance mail that is already queued. The
 * route turns a set `error` into a non-2xx, so a task reminder queue that has stopped filling
 * is still loud.
 */
async function enqueueTasksOrReport(
  deps: TaskReminderEnqueueDeps,
): Promise<EnqueueCount & { error?: string }> {
  try {
    return await enqueueTaskDueReminders(deps)
  } catch (error) {
    if (isAppError(error)) return { queued: 0, skipped: 0, error: `${error.id}: ${error.message}` }
    return {
      queued: 0,
      skipped: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Every event's task enqueue, summed, with the failing events named.
 *
 * Sequential and failure-isolated for the same two reasons `enqueueAll` in
 * `reminder-sweep.ts` is: one event's rate-limited read must not strand another event's
 * reminders, and the DAL's per-base scheduler means firing them together buys nothing.
 */
async function enqueueTasksForEvents(
  eventIds: readonly string[],
  nowMs: number,
): Promise<EnqueueCount & { error?: string }> {
  const total = { queued: 0, skipped: 0 }
  const errors: string[] = []

  for (const eventId of eventIds) {
    const result = await enqueueTasksOrReport(taskReminderDeps(eventId, nowMs))
    total.queued += result.queued
    total.skipped += result.skipped
    if (result.error !== undefined) errors.push(`${eventId}: ${result.error}`)
  }

  return errors.length === 0 ? total : { ...total, error: errors.join('; ') }
}

/**
 * Which events this run covers.
 *
 * A named event is the admin "run now" button and wins outright. With none, EVERY event in
 * the base is swept, which is the fix for the defect this file used to have: a Cron Trigger
 * carries no parameters, so the sweep fell back to `PORTAL_EVENT_ID` and drained that one
 * event's mail forever. On the graded base that showed as one event with 26 rows sent and
 * none queued sitting beside a second with 14 rows queued and not one attempt against them.
 *
 * `portalEventId()` survives only as the fallback for a base that cannot be listed, so an
 * Airtable outage degrades to the old single-event behaviour rather than to no mail at all.
 * It throws when unset, and that throw is swallowed here for the same reason: an unset
 * `PORTAL_EVENT_ID` is no longer a reason for the sweep to do nothing.
 */
async function eventsToSweep(scoped: string | undefined): Promise<readonly string[]> {
  if (scoped !== undefined) return [scoped]

  try {
    return sweepEventIds(await listEventsForSweep(), undefined)
  } catch (error) {
    console.error('[cron] could not list events to sweep, falling back to PORTAL_EVENT_ID', error)
    try {
      return [portalEventId()]
    } catch {
      return []
    }
  }
}

/**
 * Run the sweep against the real world.
 *
 * The TASK sweep runs BEFORE `runReminderSweep`, which is the same enqueue-before-drain
 * ordering that file argues for and for the same reason: a reminder that came due since the
 * last run goes out in this run rather than waiting another five minutes, which matters most
 * at the 24 hour offset. Both enqueues land ahead of the single drain inside the sweep, so
 * one invocation queues and sends.
 *
 * It is wired HERE and not inside `runReminderSweep` deliberately. The draft reminder's
 * behaviour is pinned by tests, and the two jobs answer to different tables and different
 * deadlines; composing them at the wiring layer is what keeps this addition from being able
 * to change what the CFP reminder does.
 *
 * The DRAIN is scoped differently from the two enqueues, and that asymmetry is the point.
 * The enqueues have to run once per event because what is due depends on that event's forms
 * and tasks. The drain reads the whole outbox table in one request whatever it is asked for
 * (`listDueOutbox`), so running it per event would multiply the requests without covering a
 * single extra row: it is handed `undefined` and covers the base in one pass, oldest first,
 * with `DRAIN_LIMIT` still bounding the run.
 */
export async function runRemindersJob(
  options: { eventId?: string } = {},
): Promise<SweepResult & { taskReminders: EnqueueCount & { error?: string } }> {
  // One instant for the whole sweep. Reading the clock again inside the drain would let a
  // row become due mid-run and be sent by a due-list it was not part of.
  const nowMs = Date.now()
  const eventIds = await eventsToSweep(options.eventId)

  const taskReminders = await enqueueTasksForEvents(eventIds, nowMs)

  const sweep = await runReminderSweep({
    reminders: eventIds.map((eventId) => reminderDeps(eventId, nowMs)),
    drain: drainDeps(options.eventId, nowMs),
  })

  return { ...sweep, taskReminders }
}
