// The producers: the places in the product where something happens that a webhook subscriber
// asked to hear about.
//
// Its own module rather than calls inlined at each site, for two reasons that are both about
// the call sites rather than about tidiness.
//
// **A webhook must never be able to fail the thing it is reporting.** An organizer pressing
// Accept on fifteen submissions is doing the important work; queueing a Discord notification
// is not, and a mis-typed URL in some settings row must not turn that into a failed bulk
// action with rows already written. So every function here swallows its own failure. The
// delivery queue has its own retry and its own dead-letter (`deliver.ts`); what it cannot
// recover from is a row that was never written, and that is a trade this file makes
// deliberately in favour of the mutation that came first.
//
// **The idempotency key is a rule, not a call-site decision.** `enqueueWebhookEvent` upserts
// on it, so a key derived from the clock would queue a second delivery every time an
// organizer pressed the same button twice, while a key derived from the state being announced
// collapses to one. Deriving it here means no caller can get that wrong.

import type { SubmissionStatus } from '@/constants/status'
import { enqueueWebhookEvent } from '@/features/webhooks/enqueue'
import { getSpeaker } from '@/services/airtable/queries'
import type { RecordId } from '@/types/ids'

/** What every producer needs off a submission, and nothing more. */
type AnnounceableSubmission = {
  readonly id: RecordId
  readonly code: string
  readonly title: string
}

/** The slot a session was published into. `room` is the room's NAME, not its id. */
type AnnounceableSlot = {
  readonly startsAt: string
  readonly endsAt?: string
  readonly room?: string
}

/**
 * A submission moved between decision states.
 *
 * The key names the submission and the status it moved TO, not the transition it made: two
 * routes to `accepted` are one announcement, and re-running the same decision announces
 * nothing new. `previousStatus` still rides in the payload, because a subscriber rendering
 * "Rejected → Accepted" wants it; it just does not get a vote on identity.
 */
export async function announceStatusChange(
  eventId: RecordId,
  submission: AnnounceableSubmission,
  newStatus: SubmissionStatus,
  previousStatus?: SubmissionStatus,
): Promise<void> {
  await announce({
    eventId,
    key: `submission.status_changed:${submission.id}:${newStatus}`,
    payload: {
      type: 'submission.status_changed',
      submission: { id: submission.id, code: submission.code, title: submission.title },
      newStatus,
      ...(previousStatus === undefined ? {} : { previousStatus }),
    },
  })
}

/**
 * A new submission arrived through the public CFP.
 *
 * Keyed on the submission id alone: a submission is created once, so there is no second state
 * for this to collide with.
 */
export async function announceSubmissionCreated(
  eventId: RecordId,
  submission: AnnounceableSubmission,
): Promise<void> {
  await announce({
    eventId,
    key: `submission.created:${submission.id}`,
    payload: {
      type: 'submission.created',
      submission: { id: submission.id, code: submission.code, title: submission.title },
    },
  })
}

/**
 * A speaker finished one of the tasks the organizer assigned them.
 *
 * Keyed on the assignment rather than the task: one task is assigned to many speakers, so a
 * key naming the task would let the first completion silently swallow everybody else's. The
 * assignment is the one row that means "this person, this task", which is exactly the thing
 * that completes once. Reopening and re-completing is therefore one announcement, and the
 * product has no reopen control anyway.
 */
export async function announceTaskCompleted(
  eventId: RecordId,
  assignmentId: RecordId,
  task: { id: RecordId; title: string },
  speakerId?: RecordId,
): Promise<void> {
  const speaker = await speakerRef(speakerId)
  await announce({
    eventId,
    key: `task.completed:${assignmentId}`,
    payload: {
      type: 'task.completed',
      task: { id: task.id, title: task.title },
      ...(speaker === undefined ? {} : { speaker }),
    },
  })
}

/**
 * A scheduled session became visible on the public agenda.
 *
 * The key carries the slot it was published INTO, not the publication alone. Publishing is
 * reversible from the same button, so an organizer who unpublishes, moves a session and
 * publishes again has announced something new and their channel should say so; pressing
 * Publish twice on the same slot has not, and the second press is dropped. (The second press
 * usually never reaches here at all, because `publicationChange` sees no transition to make.
 * This covers the retry of a request whose response was lost.)
 */
export async function announceSessionPublished(
  eventId: RecordId,
  submission: AnnounceableSubmission,
  slot: AnnounceableSlot,
): Promise<void> {
  await announce({
    eventId,
    key: `session.published:${submission.id}:${slot.startsAt}`,
    payload: {
      type: 'session.published',
      submission: { id: submission.id, code: submission.code, title: submission.title },
      slot,
    },
  })
}

/**
 * The speaker as a subscriber should see them, or `undefined` rather than a guess.
 *
 * Two absences are deliberate. A read that FAILS returns `undefined`, because a name is
 * decoration on this payload and a webhook must never be the reason a speaker's own task
 * completion errors. And a speaker with no name on file is dropped entirely rather than
 * falling back to their email the way `displayNameOf` does: that fallback is right for a
 * screen the organizer is already looking at and wrong for an HTTP POST to a URL somebody
 * typed into a settings box, which is where this ends up.
 *
 * `getSpeaker` is the cached, `speaker:{id}`-tagged read, so this costs a cache hit.
 */
async function speakerRef(speakerId?: RecordId): Promise<{ id: string; name: string } | undefined> {
  if (speakerId === undefined) return undefined
  try {
    const speaker = await getSpeaker(speakerId)
    const name = `${speaker.firstName} ${speaker.lastName}`.trim()
    return name === '' ? undefined : { id: speaker.id, name }
  } catch {
    return undefined
  }
}

/**
 * The swallow, in one place so every producer above inherits it and none of them restates it.
 *
 * Nothing is logged on the happy path and the failure is logged rather than rethrown, per the
 * header. `console.error` is what the cron routes in this app already use for the same class
 * of "recoverable, but somebody should see it" event.
 */
async function announce(occurrence: Parameters<typeof enqueueWebhookEvent>[0]): Promise<void> {
  try {
    await enqueueWebhookEvent(occurrence)
  } catch (error) {
    console.error('[webhooks] enqueue failed', occurrence.key, error)
  }
}
