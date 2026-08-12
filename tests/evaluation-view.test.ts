// The per-round reviewer pool and the anonymisation toggle, as the Evaluation surface
// actually applies them.
//
// Run against the FIXTURE source, which is what an empty `.env` gets: `hasAirtable()` is
// false here, so `loadEvaluationView` reads `FIXTURE_ROUNDS` and friends. That is on
// purpose rather than convenient. The two fixture rounds are deliberately configured as
// opposites (Screening is open and blind, Final is restricted to fixUser2 and not
// anonymised), so these tests pin the fixture demo and the rules at the same time, and a
// fixture edited to be uniform would fail here rather than quietly stop demonstrating
// anything.
//
// The anonymisation assertion is about the PAYLOAD, not about a rendered class. A round
// marked anonymous must not put author names in the object the panel receives, because
// anything in that object is one network-tab open away from the reviewer it is hidden
// from.

import { describe, expect, it } from 'vitest'

import { loadEvaluationView } from '@/features/review/evaluation-view'
import { FIXTURE_ROUNDS } from '@/services/airtable/fixtures'

const EVENT = 'fixEvent1'
const ADMIN = 'fixUser1'
const IN_POOL = 'fixUser2'
const OUT_OF_POOL = 'fixUser3'

const screening = FIXTURE_ROUNDS[0]
const final = FIXTURE_ROUNDS[1]

describe('the fixture rounds are configured as opposites, which the tests below rely on', () => {
  it('has one blind open round and one named restricted round', () => {
    expect(screening).toMatchObject({ anonymous: true, reviewerIds: [] })
    expect(final).toMatchObject({ anonymous: false, reviewerIds: [IN_POOL] })
  })
})

describe('per-round reviewer pool', () => {
  it('hides a round from a reviewer outside its pool', async () => {
    const view = await loadEvaluationView({
      eventId: EVENT,
      reviewerId: OUT_OF_POOL,
      role: 'reviewer',
    })

    expect(view.rounds.map((round) => round.id)).toEqual([screening.id])
  })

  it('shows it to a reviewer inside the pool', async () => {
    const view = await loadEvaluationView({
      eventId: EVENT,
      reviewerId: IN_POOL,
      role: 'reviewer',
    })

    expect(view.rounds.map((round) => round.id)).toEqual([screening.id, final.id])
  })

  it('shows every round to an admin, who is the one configuring them', async () => {
    const view = await loadEvaluationView({ eventId: EVENT, reviewerId: ADMIN, role: 'admin' })
    expect(view.rounds.map((round) => round.id)).toEqual([screening.id, final.id])
  })

  it('pares the assignment panel to the active round pool', async () => {
    const view = await loadEvaluationView({
      eventId: EVENT,
      reviewerId: ADMIN,
      role: 'admin',
      roundId: final.id,
    })

    expect(view.reviewers.map((person) => person.id)).toEqual([IN_POOL])
  })

  it('leaves the panel open to everyone on a round with no pool', async () => {
    const view = await loadEvaluationView({
      eventId: EVENT,
      reviewerId: ADMIN,
      role: 'admin',
      roundId: screening.id,
    })

    expect(view.reviewers.length).toBeGreaterThan(1)
  })
})

describe('anonymisation', () => {
  it('keeps author names out of the payload entirely on an anonymised round', async () => {
    const view = await loadEvaluationView({
      eventId: EVENT,
      reviewerId: IN_POOL,
      role: 'reviewer',
      roundId: screening.id,
    })

    expect(view.queue.length).toBeGreaterThan(0)
    expect(view.queue.every((item) => item.authors === undefined)).toBe(true)
    // Not merely absent: the round says it is a decision, which is what ABS-07 failed on.
    expect(view.rounds.find((round) => round.id === screening.id)?.anonymous).toBe(true)
  })

  it('carries the round settings out to the panel so it can say which state it is in', async () => {
    const view = await loadEvaluationView({
      eventId: EVENT,
      reviewerId: ADMIN,
      role: 'admin',
      roundId: final.id,
    })

    expect(view.rounds.find((round) => round.id === final.id)).toMatchObject({
      anonymous: false,
      reviewerIds: [IN_POOL],
    })
  })
})
