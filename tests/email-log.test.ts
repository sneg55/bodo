// The email history projection.
//
// The ordering rule is the one worth pinning, because it is the one that looks arbitrary
// until it is wrong: a SENT row is explained by when it went, and a QUEUED one by when it
// is due. Sorting both on a single column interleaves them meaninglessly, so a message
// scheduled for next week would sit above one that went out this morning.

import { describe, expect, it } from 'vitest'

import { buildEmailLog, emailSourceLabel } from '@/features/comms/log'
import { idempotencyKeys } from '@/features/comms/triggers'
import type { OutboxRow } from '@/types/domain'

const row = (overrides: Partial<OutboxRow> & { id: string }): OutboxRow => ({
  eventId: 'evt1',
  templateSource: 'system',
  idempotencyKey: `key-${overrides.id}`,
  payload: { subject: 'Subject', html: '<p>Body</p>', attachIcs: false },
  toEmail: 'ada@example.com',
  sendAt: '2026-08-01T09:00:00.000Z',
  status: 'queued',
  attempts: 0,
  ...overrides,
})

const UTC = 'UTC'

describe('buildEmailLog', () => {
  it('orders a sent row by when it sent, not by when it was queued', () => {
    const log = buildEmailLog(
      [
        // Queued long ago, sent this morning.
        row({
          id: 'a',
          status: 'sent',
          sendAt: '2026-08-01T09:00:00.000Z',
          sentAt: '2026-08-09T08:00:00.000Z',
        }),
        // Queued for next week and not yet sent.
        row({ id: 'b', status: 'queued', sendAt: '2026-08-15T09:00:00.000Z' }),
        row({
          id: 'c',
          status: 'sent',
          sendAt: '2026-08-01T09:00:00.000Z',
          sentAt: '2026-08-02T08:00:00.000Z',
        }),
      ],
      UTC,
    )

    // `b` is genuinely the latest instant of the three: it is due after either send.
    expect(log.rows.map((entry) => entry.id)).toEqual(['b', 'a', 'c'])
  })

  it('counts every status, including the ones nothing has reached', () => {
    const log = buildEmailLog([row({ id: 'a', status: 'sent' }), row({ id: 'b' })], UTC)

    expect(log.counts.sent).toBe(1)
    expect(log.counts.queued).toBe(1)
    // Present rather than absent, so a caller can render "0 failed" without a lookup miss.
    expect(log.counts.dead).toBe(0)
  })

  it('carries the failure reason, which is the point of a log over a status column', () => {
    const log = buildEmailLog(
      [row({ id: 'a', status: 'failed', attempts: 3, lastError: 'domain not verified' })],
      UTC,
    )

    expect(log.rows[0]).toMatchObject({ attempts: 3, lastError: 'domain not verified' })
  })

  it('shows the subject that was actually sent, not one re-rendered now', () => {
    // `payload` is snapshotted at enqueue, so a template edited afterwards cannot rewrite
    // history. This asserts the projection reads the snapshot rather than a template.
    const log = buildEmailLog(
      [
        row({
          id: 'a',
          payload: { subject: 'As it went out', html: '<p>x</p>', attachIcs: false },
        }),
      ],
      UTC,
    )

    expect(log.rows[0].subject).toBe('As it went out')
  })

  it('is empty and countable for an event that has never mailed anybody', () => {
    const log = buildEmailLog([], UTC)
    expect(log.rows).toEqual([])
    expect(log.counts.sent).toBe(0)
  })
})

describe('emailSourceLabel', () => {
  it('names where the body came from in words an organizer recognises', () => {
    expect(emailSourceLabel('manual')).toBe('Hand-composed')
    expect(emailSourceLabel('template')).toBe('Template')
    expect(emailSourceLabel('form_inline')).toBe('Form')
    expect(emailSourceLabel('system')).toBe('System')
  })
})

describe('hand-composed sends', () => {
  // The gap this closes: the composer promises the send is recorded as composed by hand, and
  // the Source column said `System`, which is what every automated message says too. The
  // stored column genuinely is `system` (three-option single select, no `manual` to write),
  // so the log reads the key instead.
  it('reports a bulk send as hand-composed even though the row stores system', () => {
    const key = idempotencyKeys.cohort('2026-08-11:abc', 'spk1')
    const log = buildEmailLog(
      [row({ id: 'a', templateSource: 'system', idempotencyKey: key })],
      UTC,
    )

    expect(log.rows[0].source).toBe('manual')
    expect(emailSourceLabel(log.rows[0].source)).toBe('Hand-composed')
  })

  it('leaves automated mail alone, which is the half that makes the column mean anything', () => {
    const log = buildEmailLog(
      [
        row({
          id: 'a',
          templateSource: 'system',
          idempotencyKey: idempotencyKeys.accepted('sub1', '2026-08-11T00:00:00.000Z', 'spk1'),
        }),
        row({
          id: 'b',
          templateSource: 'template',
          idempotencyKey: idempotencyKeys.speakerInvite('spk1', 'first'),
        }),
        row({
          id: 'c',
          templateSource: 'form_inline',
          idempotencyKey: idempotencyKeys.confirmation('sub1'),
        }),
      ],
      UTC,
    )

    expect(log.rows.map((entry) => entry.source)).toEqual(['system', 'template', 'form_inline'])
  })

  it('classifies rows queued before this existed, because nothing was migrated', () => {
    // The whole reason the value is derived: a key written months ago already carries it.
    const log = buildEmailLog([row({ id: 'a', idempotencyKey: 'cohort:2026-01-02:zz:spk9' })], UTC)

    expect(log.rows[0].source).toBe('manual')
  })
})

describe('failureCount', () => {
  // What the table hangs `Show all N failure reasons` off. A hover tooltip showed one reason
  // at a time, and one reason at a time cannot tell an organizer that all forty say the same
  // thing, which is the diagnosis.
  it('counts the rows that have a reason to open, not the rows that failed', () => {
    const log = buildEmailLog(
      [
        row({ id: 'a', status: 'dead', lastError: 'domain not verified' }),
        row({ id: 'b', status: 'failed', lastError: 'domain not verified' }),
        // Failed with nothing on it: there is no reason to open, so it must not be counted.
        row({ id: 'c', status: 'failed' }),
        row({ id: 'd', status: 'sent' }),
      ],
      UTC,
    )

    expect(log.failureCount).toBe(2)
    expect(log.counts.failed).toBe(2)
  })

  it('is zero for a healthy log, so the control does not render at all', () => {
    expect(buildEmailLog([row({ id: 'a', status: 'sent' })], UTC).failureCount).toBe(0)
  })
})
