// Who a committee assignment would actually reach, worked out before the press rather than
// after it.
//
// The bug this exists for: on a round whose reviewer pool is one person, picking the default
// `Program Committee` and pressing `Assign to Initial Review` wrote nothing. The action was
// right to refuse (`assignCommitteeAction` filters the committee against `Round.reviewerIds`,
// because a team is keyed by event and knows nothing about a round), but the panel gave the
// organizer nothing to go on: the select still read `Program Committee`, the button was still
// enabled, and the only signal was an error toast a round trip later that a reader could miss.
// It looked exactly like a control that did nothing.
//
// Pure, and tested, per the project rule about logic that is expensive to debug through the
// UI: this decides whether a button is pressable, and getting it wrong either blocks a legal
// assignment or restores the silent one.

import type { RecordId } from '@/types/domain'

export type CommitteeEligibility = {
  /** Reviewers this selection would assign to: the picked people who are in the pool. */
  readonly eligible: readonly RecordId[]
  /** Picked but excluded by the round's pool. The number the warning is about. */
  readonly excluded: number
  /**
   * What the panel says under the Committee select, or nothing when the selection is fine.
   *
   * Three different failures, because they need three different actions from an organizer:
   * an empty committee is a Team page problem, a committee the round excludes is a round
   * pool problem, and no reviewers picked at all is this panel's own problem.
   */
  readonly warning?: string
}

/**
 * What one committee (or one hand-picked set) would assign to on this round.
 *
 * `pool` is the round's reviewer list as the panel already has it: `loadEvaluationView`
 * pares `reviewers` down to `Round.reviewerIds` where the round names one, and an empty
 * pool on the round means everyone on the event, which is why this takes the RESOLVED list
 * rather than the round. Nothing here knows that rule and nothing here should.
 */
export function committeeEligibility(input: {
  /** Everybody the picked committee holds, or the individually ticked reviewers. */
  readonly picked: readonly RecordId[]
  /** The round's reviewers, already resolved. */
  readonly pool: readonly { readonly id: RecordId }[]
  /** Named in the warning, so it says which committee is empty. Absent when picking people. */
  readonly committeeName?: string
}): CommitteeEligibility {
  const inPool = new Set(input.pool.map((reviewer) => reviewer.id))
  const picked = [...new Set(input.picked)]
  const eligible = picked.filter((id) => inPool.has(id))

  return {
    eligible,
    excluded: picked.length - eligible.length,
    warning: warningFor({ committeeName: input.committeeName, picked, eligible }),
  }
}

function warningFor(input: {
  committeeName?: string
  picked: readonly RecordId[]
  eligible: readonly RecordId[]
}): string | undefined {
  const { committeeName, eligible, picked } = input
  if (eligible.length > 0) return undefined

  if (picked.length === 0) {
    return committeeName === undefined
      ? 'Pick at least one reviewer.'
      : `${committeeName} has no members yet. Add people to it under Event Team, or pick reviewers individually.`
  }
  // Members exist and none of them survived the pool filter. Both ways out are named,
  // because which one is right is the organizer's call and not this panel's.
  const people = picked.length === 1 ? 'that person is not' : 'none of them are'
  return committeeName === undefined
    ? `This round's reviewer pool does not include ${picked.length === 1 ? 'that reviewer' : 'any of those reviewers'}. Add them to the pool under Edit plan, or pick somebody already in it.`
    : `${committeeName} has ${picked.length} member${picked.length === 1 ? '' : 's'} and ${people} in this round's reviewer pool. Add them to the pool under Edit plan, or pick reviewers individually.`
}
