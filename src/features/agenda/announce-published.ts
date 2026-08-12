// The `session.published` producer: a scheduled session just appeared on the public agenda.
//
// It sits here rather than in `persistPublication`, which is where the write loop is, because
// by that point the only thing left is a `ScheduleChange`: an id, a room id and two
// timestamps. The payload a subscriber reads needs the session's CODE and TITLE and the
// room's NAME, and all three are still in memory in the actions above, so announcing from the
// loop would buy one `getSubmission` per row on a button an organizer presses over a whole
// conference. `announcePublications` is handed what the action already read.
//
// It announces the transition INTO published and nothing else. Unpublishing is not an event
// type, and a published session that is later MOVED is a schedule change rather than a
// publication, which is why `scheduleSessionAction` and `autoResolveConflictsAction` do not
// call this even though both re-assert `published` on the row they write.

import { announceSessionPublished } from '@/features/webhooks/announce'
import type { ScheduleChange } from '@/services/airtable/mutations'
import { listRooms } from '@/services/airtable/queries'
import type { SubmissionWithParticipants } from '@/types/domain'

/** One session going public, with the slot it is going public in. */
export type PublishedSession = {
  readonly submission: Pick<SubmissionWithParticipants, 'id' | 'code' | 'title'>
  readonly roomId?: string
  readonly startsAt: string
  readonly endsAt?: string
}

/**
 * The rows in this batch that are becoming published, resolved back to their sessions.
 *
 * Pure and exported so the selection is testable without a base: what is worth pinning is
 * that an unpublish batch announces nothing at all, and that a change whose session is not
 * in the list cannot produce a payload with a blank title.
 *
 * A change with no `startsAt` is dropped rather than announced with a placeholder. The
 * payload contract makes the start time mandatory (`dispatch.ts`), and `publicationChange`
 * refuses to publish an unscheduled session, so this is a data state that should not exist;
 * dropping it silently would be worse than not having the event, hence the warning.
 */
export function publishedSessions(
  changes: readonly ScheduleChange[],
  sessions: readonly SubmissionWithParticipants[],
): readonly PublishedSession[] {
  const byId = new Map(sessions.map((session) => [session.id, session]))

  return changes.flatMap((change) => {
    if (change.scheduleStatus !== 'published') return []
    const submission = byId.get(change.submissionId)
    if (submission === undefined) return []
    if (change.startsAt === undefined) {
      console.warn('[webhooks] published session has no start time', change.submissionId)
      return []
    }
    return [
      {
        submission: { id: submission.id, code: submission.code, title: submission.title },
        roomId: change.roomId,
        startsAt: change.startsAt,
        endsAt: change.endsAt,
      },
    ]
  })
}

/**
 * Tell the subscribers about every session this batch put on the public agenda.
 *
 * The room lookup is one `listRooms` for the whole batch and only when something is actually
 * being published, so publishing a forty-session agenda costs one cached, tagged read rather
 * than forty. A room that cannot be resolved leaves `room` absent, which the payload allows:
 * a session in an unnamed room is still worth announcing.
 *
 * The whole body is inside the swallow, not just the enqueue. `announceSessionPublished`
 * guards itself, but `listRooms` above it does not, and a read that throws here would fail a
 * Publish whose sessions are already public. Nothing a webhook needs may cost the organizer
 * the action they actually pressed; see the header of features/webhooks/announce.ts.
 */
export async function announcePublications(
  eventId: string,
  changes: readonly ScheduleChange[],
  sessions: readonly SubmissionWithParticipants[],
): Promise<void> {
  const published = publishedSessions(changes, sessions)
  if (published.length === 0) return

  try {
    const roomNames = new Map((await listRooms(eventId)).map((room) => [room.id, room.name]))

    for (const entry of published) {
      const room = entry.roomId === undefined ? undefined : roomNames.get(entry.roomId)
      await announceSessionPublished(eventId, entry.submission, {
        startsAt: entry.startsAt,
        ...(entry.endsAt === undefined ? {} : { endsAt: entry.endsAt }),
        ...(room === undefined ? {} : { room }),
      })
    }
  } catch (error) {
    console.error('[webhooks] announcing publications failed', eventId, error)
  }
}
