// Resolve one task assignment as the acting speaker's, ACROSS EVERY EVENT they are in.
//
// THE DEFECT this exists to fix, filed as major by the eval run of 2026-08-11: `MARK
// COMPLETE` on /portal/tasks failed. A submission task answered the error toast "no such
// task assignment", a manual task failed silently, and neither survived a reload. A second
// speaker, on a different account, saw completion work. Both observations were the same
// bug: the portal reads went multi-event (`readOwnTasks` loops the speaker's whole event
// scope) and the WRITES stayed on the one configured `PORTAL_EVENT_ID`, so a task shown
// from any other event was listed by a query that never included it and then refused as
// though it did not exist.
//
// So the scope used to WRITE is now the same scope used to READ, and widening it is exactly
// where an authorization mistake would live. Three things keep it honest, and none of them
// is optional:
//
//   1. The scope is the SPEAKER'S OWN EVENTS (`portalEventIds`), never "any event". It is an
//      authorization boundary, not a filter, so an assignment on an event the speaker is not
//      in is never even queried and therefore answers not-found rather than being fetched
//      and then refused.
//   2. The lists are speaker-scoped by the port, and `assertOwnsAssignment` STILL runs on
//      the row that matched. The scoping is a query somebody else implements; this is the
//      invariant. A future port that widens its filter is refused here.
//   3. The event the caller gets back is the one the row was FOUND under, not the configured
//      one and not a value read off the record, so everything downstream (the form lookup,
//      the tags a completion expires) names the conference the task actually belongs to.
//
// The resolution is split in two on purpose: `ownAssignmentIn` is pure, so all four
// outcomes (own event, another of the speaker's events, another speaker's row, an event
// outside the scope) are unit tested in tests/portal-own-assignment.test.ts rather than
// only reachable through a browser with two logins.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { assertOwnsAssignment, speakerSubject } from '@/features/portal/authorize'
import { type PortalTaskItem, portalDataPort } from '@/features/portal/ports'
import type { RecordId } from '@/types/domain'

/** One event's assignments for one speaker, tagged with the event they were read under. */
export type ScopedAssignments = {
  eventId: RecordId
  items: readonly PortalTaskItem[]
}

export type OwnedAssignment = {
  /**
   * The event the assignment was found under.
   *
   * The queried event and not `item.task.eventId`, deliberately: the queried one is inside
   * the authorized scope by construction, so a port handing back a row from somewhere else
   * cannot move a write out of the events the speaker belongs to.
   */
  eventId: RecordId
  item: PortalTaskItem
}

export type AssignmentLookup = {
  speakerId: RecordId
  assignmentId: string
}

/**
 * Find the assignment inside the already-scoped lists, or refuse.
 *
 * Not-found and outside-the-scope are the same answer, the same call `resolveOwnSubmission`
 * makes: an id that resolves to nothing tells the caller nothing about whose it is.
 */
export function ownAssignmentIn(
  scoped: readonly ScopedAssignments[],
  lookup: AssignmentLookup,
): OwnedAssignment {
  for (const { eventId, items } of scoped) {
    const item = items.find((candidate) => candidate.assignment.id === lookup.assignmentId)
    if (item === undefined) continue

    assertOwnsAssignment(speakerSubject(lookup.speakerId), item)
    return { eventId, item }
  }

  throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'no such task assignment', {
    assignmentId: lookup.assignmentId,
  })
}

/**
 * The same resolution against the data port, one read per event in the scope.
 *
 * `eventIds` is passed in rather than resolved here so the caller resolves the speaker and
 * their scope once and every step of a mutation shares it. Every caller passes
 * `portalEventIds(speakerId)`.
 *
 * One read per event, exactly as `readOwnTasks` does it, which is one call in the ordinary
 * single-event case and hits the same cache entries that page already warmed.
 */
export async function resolveOwnAssignment(
  input: AssignmentLookup & { eventIds: readonly RecordId[] },
): Promise<OwnedAssignment> {
  const port = portalDataPort()
  const scoped = await Promise.all(
    input.eventIds.map(async (eventId) => ({
      eventId,
      // `fresh`, because this answer decides OWNERSHIP for a write. Reading the same cached
      // list the portal page renders from made every `Mark complete` on the deployed Worker
      // answer "no such task assignment" for rows the speaker was looking at (2026-08-12 eval
      // run, reproduced on two tasks of two different kinds). read-cache.ts already stated the
      // rule this was breaking: an assignment lookup on a write path is not a cacheable read.
      items: await port.listTaskAssignments({
        eventId,
        speakerId: input.speakerId,
        fresh: true,
      }),
    })),
  )

  return ownAssignmentIn(scoped, input)
}
