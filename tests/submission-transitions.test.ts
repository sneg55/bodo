import { describe, expect, it } from 'vitest'

import { isAppError } from '@/constants/errorIds'
import { SUBMISSION_STATUSES } from '@/constants/status'
import {
  assertTransition,
  canTransition,
  commitTarget,
  decisionOf,
  legalNextStatuses,
  notifyTarget,
  queueTarget,
} from '@/features/submissions/transitions'

describe('submission transitions', () => {
  it('refuses pending straight to accepted, because that would skip the notification', () => {
    expect(canTransition('pending', 'accepted')).toBe(false)
    expect(() => assertTransition('pending', 'accepted')).toThrow()

    try {
      assertTransition('pending', 'accepted', { submissionId: 'rec1' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(isAppError(error)).toBe(true)
      if (isAppError(error)) {
        expect(error.id).toBe('E_SUB_005')
        expect(error.context.submissionId).toBe('rec1')
      }
    }
  })

  it('refuses pending straight to declined too', () => {
    expect(canTransition('pending', 'declined')).toBe(false)
  })

  it('allows the two-step route through each queue', () => {
    expect(canTransition('pending', 'accept_queue')).toBe(true)
    expect(canTransition('accept_queue', 'accepted')).toBe(true)
    expect(canTransition('pending', 'decline_queue')).toBe(true)
    expect(canTransition('decline_queue', 'declined')).toBe(true)
  })

  it('treats a no-op edit as legal, since the chip editor commits on Save either way', () => {
    for (const status of SUBMISSION_STATUSES) {
      expect(canTransition(status, status)).toBe(true)
      expect(() => assertTransition(status, status)).not.toThrow()
    }
  })

  it('lets a mistaken accept be walked back without editing Airtable by hand', () => {
    expect(canTransition('accepted', 'decline_queue')).toBe(true)
    expect(canTransition('declined', 'pending')).toBe(true)
  })

  it('never advertises a transition it would then refuse', () => {
    for (const from of SUBMISSION_STATUSES) {
      for (const to of legalNextStatuses(from)) {
        expect(canTransition(from, to)).toBe(true)
      }
    }
  })

  it('maps a bulk decision to its staging state', () => {
    expect(queueTarget('accept')).toBe('accept_queue')
    expect(queueTarget('decline')).toBe('decline_queue')
  })

  it('commits only the two staged states, and skips everything else', () => {
    expect(commitTarget('accept_queue')).toBe('accepted')
    expect(commitTarget('decline_queue')).toBe('declined')
    for (const status of ['draft', 'pending', 'accepted', 'declined', 'withdrawn'] as const) {
      expect(commitTarget(status)).toBeUndefined()
    }
  })

  it('every commit target maps back to the decision that produced it', () => {
    expect(decisionOf('accepted')).toBe('accept')
    expect(decisionOf('declined')).toBe('decline')
    expect(decisionOf('pending')).toBeUndefined()
  })
})

// CFP-14: `accept_queue -> accepted` and `decline_queue -> declined` are both legal direct
// moves (a mistaken accept has to be walkable back in one hop), and the inline status chip
// offers every legal next status. An organizer who takes that shortcut lands a row nothing
// can get back into a queue: `accepted`'s only legal next moves are `withdrawn` and
// `decline_queue`. `notifyTarget` is what stops that from being a permanent dead end.
describe('notifyTarget', () => {
  it('matches commitTarget for a staged row', () => {
    expect(notifyTarget('accept_queue', undefined)).toBe('accepted')
    expect(notifyTarget('decline_queue', undefined)).toBe('declined')
  })

  it('is still notifiable once staged, even carrying an OLD notifiedAt from a prior round', () => {
    // The row was notified, reversed, and re-staged. That earlier stamp does not mean
    // THIS decision was sent; the outbox's idempotency key is what tells those apart.
    expect(notifyTarget('accept_queue', '2026-08-01T00:00:00.000Z')).toBe('accepted')
  })

  it('treats a row already decided but never notified as notifiable, targeting itself', () => {
    expect(notifyTarget('accepted', undefined)).toBe('accepted')
    expect(notifyTarget('declined', undefined)).toBe('declined')
  })

  it('excludes a decided row that already carries a notifiedAt, so it is not sent twice', () => {
    expect(notifyTarget('accepted', '2026-08-01T00:00:00.000Z')).toBeUndefined()
    expect(notifyTarget('declined', '2026-08-01T00:00:00.000Z')).toBeUndefined()
  })

  it('has nothing to send for every other status', () => {
    for (const status of ['draft', 'pending', 'withdrawn'] as const) {
      expect(notifyTarget(status, undefined)).toBeUndefined()
      expect(notifyTarget(status, '2026-08-01T00:00:00.000Z')).toBeUndefined()
    }
  })

  it('is always a status assertTransition accepts as a no-op or a legal move from itself', () => {
    for (const status of SUBMISSION_STATUSES) {
      for (const notifiedAt of [undefined, '2026-08-01T00:00:00.000Z']) {
        const target = notifyTarget(status, notifiedAt)
        if (target === undefined) continue
        expect(canTransition(status, target)).toBe(true)
      }
    }
  })
})
