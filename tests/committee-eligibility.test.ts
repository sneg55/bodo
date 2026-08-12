// What the assignment panel says before the press, and when it refuses to offer one.
//
// The case that produced this: on the seeded event, Initial Review has a one-person reviewer
// pool, the Committee select defaults to `Program Committee`, and pressing
// `Assign to Initial Review` with two submissions selected wrote nothing at all. The action
// was right (`assignCommitteeAction` filters the committee against the round's pool), but the
// panel offered the press anyway and the refusal arrived as a toast a round trip later.

import { describe, expect, it } from 'vitest'

import { committeeEligibility } from '@/features/review/committee-eligibility'

const pool = [{ id: 'recUser1' }, { id: 'recUser2' }]

describe('who a committee assignment would reach', () => {
  it('keeps the picked reviewers who are in the round pool', () => {
    const result = committeeEligibility({
      picked: ['recUser1', 'recOutsider'],
      pool,
      committeeName: 'Program Committee',
    })

    expect(result.eligible).toEqual(['recUser1'])
    expect(result.excluded).toBe(1)
    // Somebody would be assigned, so there is nothing to warn about: the partial exclusion
    // is the round pool doing its job, not a press that will do nothing.
    expect(result.warning).toBeUndefined()
  })

  it('names the committee when the round pool excludes every one of its members', () => {
    const result = committeeEligibility({
      picked: ['recOutsider1', 'recOutsider2'],
      pool,
      committeeName: 'Program Committee',
    })

    expect(result.eligible).toEqual([])
    expect(result.warning).toContain('Program Committee has 2 members')
    expect(result.warning).toContain('none of them are in this round')
  })

  it('reads as one person when the committee holds one', () => {
    const warning = committeeEligibility({
      picked: ['recOutsider1'],
      pool,
      committeeName: 'Program Committee',
    }).warning

    expect(warning).toContain('1 member')
    expect(warning).toContain('that person is not in this round')
  })

  it('tells an empty committee apart from an excluded one', () => {
    // Different problems with different fixes: one is a Team page, the other is the round's
    // pool, and a single "nothing will be assigned" would send an organizer to the wrong one.
    const empty = committeeEligibility({ picked: [], pool, committeeName: 'Program Committee' })

    expect(empty.warning).toContain('has no members yet')
    expect(empty.excluded).toBe(0)
  })

  it('speaks about reviewers rather than committees on the individual path', () => {
    expect(committeeEligibility({ picked: [], pool }).warning).toBe('Pick at least one reviewer.')
    expect(committeeEligibility({ picked: ['recOutsider'], pool }).warning).toContain(
      "This round's reviewer pool does not include that reviewer",
    )
  })

  it('counts one person picked twice once', () => {
    // The panel's own toggle cannot produce a duplicate, but the committee read and the
    // ticked list are two different sources and `excluded` is a number shown to a human.
    const result = committeeEligibility({ picked: ['recUser1', 'recUser1'], pool })

    expect(result.eligible).toEqual(['recUser1'])
    expect(result.excluded).toBe(0)
  })
})
