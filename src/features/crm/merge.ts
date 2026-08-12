// What a speaker merge is, decided without a network.
//
// Merging is the one destructive operation in the CRM: the absorbed records are deleted, and
// Airtable has no undo an app can reach. So the decision about WHETHER a merge is legal, and
// exactly WHICH records it consumes, is made here, in a pure function that the Server Action
// calls and the tests call directly. The action's job is to establish `reachable` (the set of
// records this caller may write, derived from EventMemberships, never from the request) and
// then to obey the answer.
//
// The plan carries no field values on purpose. "The survivor keeps the primary's identity
// fields" needs no instruction at all if the survivor IS the primary record: merging into an
// existing row rather than writing a new one means the primary's id survives, so every link
// pointing at it, every bookmark of `/admin/crm/{id}`, and its whole edit history stay valid.
// What the write has to do is repoint the ABSORBED records' links, and the ids for that are
// the plan. See `mutations-crm-merge.ts`.

import type { RecordId } from '@/types/domain'

/**
 * A ceiling on one merge, not a data limit.
 *
 * The write repoints six link tables and then deletes rows, and every one of those steps is
 * unbounded in the number of Airtable requests it can cost. Ten is well past any real
 * cluster (the audit's worst case was five `Priya Raman` records) and keeps one confirmation
 * dialog readable: a list of forty names is not a thing anybody checks before pressing a
 * button that cannot be undone.
 */
export const MERGE_MAX_RECORDS = 10

/** What the caller asked for. Both fields arrive from the browser and neither is trusted. */
export type MergeRequest = {
  readonly primaryId: RecordId
  /** Every record in the merge, INCLUDING the primary. */
  readonly speakerIds: readonly RecordId[]
}

export type MergePlan = {
  /** Survives, keeps its id, and keeps its own identity fields. */
  readonly primaryId: RecordId
  /** Deleted, after their links have been moved onto the primary. Never empty. */
  readonly absorbedIds: readonly RecordId[]
}

export type MergeCheck = { readonly ok: true; readonly plan: MergePlan } | MergeRefusal
type MergeRefusal = { readonly ok: false; readonly reason: string }

/**
 * The plan, or the sentence to show the organizer.
 *
 * `reachable` is the set of speaker records the caller may write, which the action derives
 * from its own scope. It is passed in rather than looked up because that keeps this function
 * pure, and because it makes the security property visible at the call site: a record outside
 * the set cannot be absorbed, so a merge cannot be used to delete a record on somebody else's
 * event by naming its id.
 *
 * The reasons are worded for a human. They cross the action boundary as an `ActionResult`
 * failure, which is the whole point of that type: a thrown error would reach the browser as a
 * redacted digest and the organizer would be told "an error occurred" while the real answer
 * was "you unticked the primary".
 */
export function checkMerge(request: MergeRequest, reachable: ReadonlySet<RecordId>): MergeCheck {
  // Deduplicated first, so ticking a row twice through two controls is not an error and does
  // not make the record get absorbed into itself.
  const speakerIds = [...new Set(request.speakerIds)]

  if (speakerIds.length < 2) {
    return refuse('Pick at least two records to merge.')
  }
  if (speakerIds.length > MERGE_MAX_RECORDS) {
    return refuse(`Merge at most ${MERGE_MAX_RECORDS} records at a time.`)
  }
  if (!speakerIds.includes(request.primaryId)) {
    return refuse('Choose which of the selected records to keep.')
  }
  if (speakerIds.some((id) => !reachable.has(id))) {
    // One answer for "not there" and "not yours", the same reasoning `refuseList` gives in
    // actions.ts: a probe must not be able to tell an id that does not exist from a record on
    // an event this caller holds no admin membership on.
    return refuse('One of those records is not one you can edit.')
  }

  return {
    ok: true,
    plan: {
      primaryId: request.primaryId,
      absorbedIds: speakerIds.filter((id) => id !== request.primaryId),
    },
  }
}

function refuse(reason: string): MergeRefusal {
  return { ok: false, reason }
}

/**
 * The sentence the confirmation dialog states before the button that cannot be undone.
 *
 * Built here rather than in the dialog so the wording is asserted by a test instead of by
 * somebody reading JSX: an irreversible action whose description drifts from what it does is
 * worse than one with no description. It names the count, the surviving record, and the three
 * things that move, in that order, because the count is what an organizer checks first.
 */
export function mergeSummary(primaryName: string, absorbedNames: readonly string[]): string {
  const plural = absorbedNames.length === 1 ? 'record' : 'records'
  return (
    `${absorbedNames.length} ${plural} (${absorbedNames.join(', ')}) will be permanently ` +
    `deleted. Their events, sessions, tasks, files and tags move to ${primaryName}, which ` +
    `keeps its own name, email and profile. This cannot be undone.`
  )
}
