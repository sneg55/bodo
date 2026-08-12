// The trigger graph's idempotency keys.
//
// A key that varies between the enqueue and a later retry is not an idempotency key,
// it is a duplicate generator, so what these tests pin is which changes to the world
// produce a NEW message and which must collapse onto the existing one.

import { describe, expect, it } from 'vitest'

import {
  DRAFT_REMINDER_HOURS,
  draftReminderTimes,
  idempotencyKeys,
  recipientsForDecision,
} from '@/features/comms/triggers'

describe('idempotency keys', () => {
  it('collapses a double-clicked Notify onto one message', () => {
    const first = idempotencyKeys.accepted('recSub1', '2026-08-06T12:00:00.000Z', 'recSpk1')
    const second = idempotencyKeys.accepted('recSub1', '2026-08-06T12:00:00.000Z', 'recSpk1')
    expect(first).toBe(second)
  })

  it('treats a re-decision as a new message, because it is one', () => {
    // A decision reversed and remade genuinely has to reach the speaker again, and
    // only the notifiedAt stamp distinguishes it from a duplicate click.
    const first = idempotencyKeys.accepted('recSub1', '2026-08-06T12:00:00.000Z', 'recSpk1')
    const later = idempotencyKeys.accepted('recSub1', '2026-08-07T09:00:00.000Z', 'recSpk1')
    expect(later).not.toBe(first)
  })

  it('keeps accept and decline separate for the same submission and instant', () => {
    const at = '2026-08-06T12:00:00.000Z'
    expect(idempotencyKeys.accepted('recSub1', at, 'recSpk1')).not.toBe(
      idempotencyKeys.declined('recSub1', at, 'recSpk1'),
    )
  })

  it('gives each rescheduled invite its own key via the calendar sequence', () => {
    // Same UID, higher SEQUENCE is an update the client applies, so it is a real
    // second message rather than a repeat.
    expect(idempotencyKeys.invite('recSub1', 0, 'recSpk1')).not.toBe(
      idempotencyKeys.invite('recSub1', 1, 'recSpk1'),
    )
  })

  it('collapses a repeated send of the same schedule', () => {
    expect(idempotencyKeys.invite('recSub1', 2, 'recSpk1')).toBe(
      idempotencyKeys.invite('recSub1', 2, 'recSpk1'),
    )
  })

  it('keeps an invite and its cancellation apart at the same sequence', () => {
    expect(idempotencyKeys.invite('recSub1', 3, 'recSpk1')).not.toBe(
      idempotencyKeys.cancel('recSub1', 3, 'recSpk1'),
    )
  })

  it('re-arms a draft reminder when the deadline moves', () => {
    // Suppressing it forever would be the natural bug: the speaker gets no nudge for
    // the new date because they were nudged for the old one.
    const before = idempotencyKeys.draftReminder('recSub1', '2026-09-15T23:59:00.000Z', 72)
    const after = idempotencyKeys.draftReminder('recSub1', '2026-09-22T23:59:00.000Z', 72)
    expect(after).not.toBe(before)
  })

  it('keeps the 72 hour and 24 hour reminders separate', () => {
    const close = '2026-09-15T23:59:00.000Z'
    expect(idempotencyKeys.draftReminder('recSub1', close, 72)).not.toBe(
      idempotencyKeys.draftReminder('recSub1', close, 24),
    )
  })

  it('gives each participant of one decision their own key', () => {
    // The bug this replaced: one key per submission meant a three-speaker session
    // wrote a single outbox row, and two of the three were never told.
    const at = '2026-08-06T12:00:00.000Z'
    expect(idempotencyKeys.accepted('recSub1', at, 'recSpk1')).not.toBe(
      idempotencyKeys.accepted('recSub1', at, 'recSpk2'),
    )
  })

  it('sends one confirmation per submission no matter how often it is retried', () => {
    expect(idempotencyKeys.confirmation('recSub1')).toBe(idempotencyKeys.confirmation('recSub1'))
  })

  it('re-alerts admins on a later edit but not on the same one', () => {
    const at = '2026-08-08T10:00:00.000Z'
    expect(idempotencyKeys.adminUpdate('recSub1', at)).toBe(
      idempotencyKeys.adminUpdate('recSub1', at),
    )
    expect(idempotencyKeys.adminUpdate('recSub1', '2026-08-09T10:00:00.000Z')).not.toBe(
      idempotencyKeys.adminUpdate('recSub1', at),
    )
  })

  it('gives every recipient of a cohort send their own key', () => {
    expect(idempotencyKeys.cohort('send1', 'recSpk1')).not.toBe(
      idempotencyKeys.cohort('send1', 'recSpk2'),
    )
  })
})

describe('draftReminderTimes', () => {
  it('schedules one reminder per configured offset before the close date', () => {
    const times = draftReminderTimes('2026-09-15T00:00:00.000Z')

    expect(times).toHaveLength(DRAFT_REMINDER_HOURS.length)
    expect(times.at(0)).toEqual({ hoursBefore: 72, sendAt: '2026-09-12T00:00:00.000Z' })
    expect(times.at(1)).toEqual({ hoursBefore: 24, sendAt: '2026-09-14T00:00:00.000Z' })
  })

  it('returns nothing for an unparseable close date instead of throwing', () => {
    expect(draftReminderTimes('whenever')).toEqual([])
  })

  it('still returns past instants, leaving the filtering to the caller', () => {
    // A deadline moved closer can legitimately have a reminder already due, and
    // silently dropping it here would mean nobody is ever nudged.
    expect(draftReminderTimes('2020-01-10T00:00:00.000Z')).toHaveLength(2)
  })
})

describe('recipientsForDecision', () => {
  it('includes every participant, not just the submitter', () => {
    const out = recipientsForDecision([
      { speakerId: 'a', email: 'ada@example.com' },
      { speakerId: 'b', email: 'chen@example.com' },
    ])

    expect(out).toHaveLength(2)
  })

  it('does not email the same address twice when one person holds two roles', () => {
    const out = recipientsForDecision([
      { speakerId: 'a', email: 'ada@example.com' },
      { speakerId: 'a2', email: 'ADA@example.com ' },
    ])

    expect(out).toHaveLength(1)
  })

  it('skips a participant with no email rather than queueing an unsendable row', () => {
    const out = recipientsForDecision([
      { speakerId: 'a', email: '' },
      { speakerId: 'b', email: 'chen@example.com' },
    ])

    expect(out.map((r) => r.speakerId)).toEqual(['b'])
  })
})
