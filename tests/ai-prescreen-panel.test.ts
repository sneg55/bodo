// The two sentences `PrescreenPanel` does not choose for itself: why the button is disabled,
// and what one press of it reported.
//
// Split out of tests/ai-prescreen-queue.test.ts, which had grown past the file limit and is
// about the queue's own arithmetic. Both halves here are copy plus one decision, and the
// decision is the reason they are pure functions at all: there is no component test harness
// in this repo, so anything the panel decides for itself is untestable.

import { describe, expect, it } from 'vitest'

import {
  PRESCREEN_WAIT_ATTEMPTS,
  prescreenPressOutcome,
  prescreenProgressLabel,
  prescreenUnavailableReason,
  prescreenWaitState,
} from '@/features/jobs/prescreen-copy'
import { PRESCREEN_MAX_ATTEMPTS, prescreenCounts } from '@/features/jobs/prescreen-queue'

import { prescreenJob } from './helpers/prescreen-fixtures'

describe('the sentence over the progress bar', () => {
  it('counts up while the queue is draining', () => {
    const counts = prescreenCounts([
      prescreenJob({ id: 'a', status: 'done' }),
      prescreenJob({ id: 'b', status: 'queued' }),
    ])

    expect(prescreenProgressLabel(counts)).toBe('Pre-screening 1 of 2')
  })

  it('claims only what was actually scored once the queue has stopped', () => {
    // The bar is full because nothing is left to wait for, but one of these submissions was
    // never scored by anything. "Pre-screened 2 of 2" is a claim about a review that does
    // not exist, and the badge beside it saying one job stopped does not unsay it.
    const counts = prescreenCounts([
      prescreenJob({ id: 'a', status: 'done' }),
      prescreenJob({ id: 'b', status: 'running', attempts: PRESCREEN_MAX_ATTEMPTS }),
    ])

    expect(prescreenProgressLabel(counts)).toBe('Pre-screened 1 of 2')
  })

  it('reads as a clean finish when every job really was scored', () => {
    const counts = prescreenCounts([
      prescreenJob({ id: 'a', status: 'done' }),
      prescreenJob({ id: 'b', status: 'done' }),
    ])

    expect(prescreenProgressLabel(counts)).toBe('Pre-screened 2 of 2')
  })
})

describe('what one press of the button reports', () => {
  function press(result: Parameters<typeof prescreenPressOutcome>[0]['result']) {
    return prescreenPressOutcome({ roundName: 'Screening', result })
  }

  it('asks for a new render when another press won the round', () => {
    // The loser returns before the winner has created a single row, so its own counts are
    // still empty and the poller is not mounted: nothing else in this browser would ever
    // ask the server again. A press that WRITES needs no refresh, because `invalidate()`
    // re-renders the route as part of the action's own response; a press that wrote
    // nothing invalidated nothing.
    expect(press({ ok: true, queued: 0, skipped: 0, contended: true })).toEqual({
      tone: 'info',
      message: 'Screening is already being queued. That run covers this one.',
      refresh: true,
    })
  })

  it('leaves the refresh to the action on every branch that reached the base', () => {
    expect(press({ ok: true, queued: 4, skipped: 1, contended: false })).toEqual({
      tone: 'success',
      message: '4 queued for pre-screening, 1 already done. Scoring runs in the background.',
      refresh: false,
    })
    expect(press({ ok: true, queued: 0, skipped: 3, contended: false })).toMatchObject({
      tone: 'success',
      refresh: false,
    })
    expect(press({ ok: false, message: 'that round is not in the active plan' })).toEqual({
      tone: 'error',
      message: 'that round is not in the active plan',
      refresh: false,
    })
  })
})

describe('whether a panel that lost the round keeps polling', () => {
  const EMPTY = prescreenCounts([])

  it('keeps polling an empty round while it waits for the winner to write rows', () => {
    // The one refresh the loser asks for can land BEFORE the winner has created anything,
    // which is the whole bug: `total: 0` renders no progress line and nothing outstanding,
    // so without the waiting flag the poller never mounts and the panel stays empty until
    // the organizer navigates away and back.
    const state = prescreenWaitState({ counts: EMPTY, waiting: true, attempts: 1 })

    expect(state.polling).toBe(true)
    expect(state.notice).toContain('Waiting for the other run')
  })

  it('stops, and says why, when the rows never appear', () => {
    // The winner stopped before creating a single row: it took the claim, wrote nothing,
    // and no tick produces rows for a round nothing was queued for. Polling for that is
    // polling forever, so the wait ends in a sentence the organizer can act on.
    const state = prescreenWaitState({
      counts: EMPTY,
      waiting: true,
      attempts: PRESCREEN_WAIT_ATTEMPTS,
    })

    expect(state.polling).toBe(false)
    expect(state.notice).toContain('Press AI pre-screen')
  })

  it('ends the wait as soon as the winner is visible, however few attempts went by', () => {
    const counts = prescreenCounts([prescreenJob({ id: 'a', status: 'queued' })])
    const state = prescreenWaitState({ counts, waiting: true, attempts: 1 })

    expect(state).toEqual({ polling: true })
  })

  it('hands a round with rows straight back to the outstanding rule', () => {
    // Waiting or not, a settled round polls no more than it did before: the flag can only
    // extend an EMPTY panel's life, never keep a drained queue refreshing forever.
    const counts = prescreenCounts([
      prescreenJob({ id: 'a', status: 'done' }),
      prescreenJob({ id: 'b', status: 'running', attempts: PRESCREEN_MAX_ATTEMPTS }),
    ])

    expect(prescreenWaitState({ counts, waiting: true, attempts: 0 })).toEqual({ polling: false })
    expect(prescreenWaitState({ counts, waiting: false, attempts: 0 })).toEqual({ polling: false })
  })

  it('says nothing and polls nothing on an empty round nobody contended', () => {
    // A round with no assignments renders this panel too. It is not waiting for anyone, so
    // it gets no notice and no poller.
    expect(prescreenWaitState({ counts: EMPTY, waiting: false, attempts: 0 })).toEqual({
      polling: false,
    })
  })
})

describe('what the panel says when it cannot pre-screen', () => {
  it('names the missing base first, because a fixture clone cannot write at all', () => {
    // `getAiReviewerId()` answers with the FIXTURE reviewer when there is no base, so the
    // seeded-reviewer check passes and the button used to enable itself over a DAL that
    // throws CFG_ENV_MISSING on the first write.
    const reason = prescreenUnavailableReason({ hasBase: false, reviewerId: 'recAiFixture' })

    expect(reason).toContain('Airtable base')
  })

  it('names the unseeded reviewer when there is a base', () => {
    expect(prescreenUnavailableReason({ hasBase: true, reviewerId: undefined })).toContain(
      'ai@system',
    )
  })

  it('says nothing when the round can actually be pre-screened', () => {
    expect(prescreenUnavailableReason({ hasBase: true, reviewerId: 'recAi' })).toBeUndefined()
  })

  it('says the queue could not be read, and does not blame the seed for it', () => {
    const reason = prescreenUnavailableReason({
      hasBase: true,
      reviewerId: 'recAi',
      queueUnreadable: true,
    })

    expect(reason).toContain('could not be read')
    // The failure is transient and the two sentences above are settled configuration, so
    // sending an organizer to run the seed script over a read that timed out would be
    // sending them to fix something that is not broken.
    expect(reason).not.toContain('ai@system')
  })

  it('still names a settled configuration problem ahead of an unreadable queue', () => {
    // Both are true at once on a fixture clone. The base is the cause; the failed read is a
    // symptom of it, and reporting the symptom would hide the thing somebody can act on.
    expect(
      prescreenUnavailableReason({ hasBase: false, reviewerId: 'recAi', queueUnreadable: true }),
    ).toContain('Airtable base')
  })
})
