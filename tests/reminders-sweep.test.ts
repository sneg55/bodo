// The sweep that the Cron Trigger lands on: enqueue what is due, then drain.
//
// The two halves are composed rather than merged for a reason, and these tests pin
// the reasons: the drain has to run even when the enqueue half cannot reach Airtable,
// a reminder that just became due has to go out in the same sweep instead of waiting
// five minutes, and every sweep needs its own claim holder, because `claimOnce`
// re-grants to the same holder and a shared one would hand two overlapping sweeps the
// same outbox row.

import { describe, expect, it, vi } from 'vitest'

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { DrainDeps } from '@/features/comms/drain'
import type { OutboxDraft } from '@/features/comms/triggers'
import { newSweepHolder, runReminderSweep, type SweepDeps } from '@/features/jobs/reminder-sweep'
import type { ReminderEnqueueDeps } from '@/features/jobs/reminders'
import type { OutboxRow } from '@/types/domain'

const NOW = Date.parse('2026-08-08T12:00:00.000Z')
const CLOSE = new Date(NOW + 12 * 3_600_000).toISOString()

function queuedRow(over: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: 'recOut1',
    eventId: 'recEvt1',
    templateSource: 'system',
    idempotencyKey: 'draft-remind:recSub1:2026-08-09T00:00:00.000Z:72',
    toEmail: 'ada@example.com',
    sendAt: '2026-08-08T11:00:00.000Z',
    status: 'queued',
    attempts: 0,
    payload: { subject: 'Reminder', html: '<p>Finish your draft</p>', attachIcs: false },
    ...over,
  }
}

function reminderDeps(over: Partial<ReminderEnqueueDeps> = {}): ReminderEnqueueDeps {
  return {
    eventId: 'recEvt1',
    portalUrl: 'https://bodo.example.com/portal',
    nowMs: NOW,
    loadEvent: () => Promise.resolve({ name: 'AI Engineer Sandbox', slug: 'ai-engineer-sandbox' }),
    listForms: () => Promise.resolve([{ id: 'recForm1', closeDate: CLOSE }]),
    listDrafts: () =>
      Promise.resolve([
        {
          submissionId: 'recSub1',
          formId: 'recForm1',
          status: 'draft' as const,
          speakerId: 'recSpk1',
          toEmail: 'ada@example.com',
          firstName: 'Ada',
          code: 'SESS-1',
          title: 'Streaming on Workers',
        },
      ]),
    enqueue: (rows: readonly OutboxDraft[]) => Promise.resolve({ queued: rows.length, skipped: 0 }),
    ...over,
  }
}

function sweepDeps(over: { reminders?: Partial<ReminderEnqueueDeps>; drain?: Partial<DrainDeps> }) {
  const send = vi.fn<DrainDeps['send']>().mockResolvedValue({ delivered: true, messageId: 'msg_1' })
  const claim = vi.fn<DrainDeps['claim']>().mockResolvedValue({ granted: true })
  const markSent = vi.fn<DrainDeps['markSent']>().mockResolvedValue(undefined)
  const markFailed = vi.fn<DrainDeps['markFailed']>().mockResolvedValue(undefined)
  const listDue = vi.fn<DrainDeps['listDue']>().mockResolvedValue([queuedRow()])

  const deps: SweepDeps = {
    reminders: [reminderDeps(over.reminders)],
    drain: { listDue, claim, send, markSent, markFailed, nowMs: NOW, ...over.drain },
  }
  return { fns: { send, claim, markSent, markFailed, listDue }, deps }
}

describe('newSweepHolder', () => {
  it('is different on every call, so two overlapping sweeps cannot share a lease', () => {
    // `claimOnce` deliberately re-grants to the same holder so a retry does not
    // deadlock against its own lease. A reused holder therefore turns that
    // convenience into two senders holding one row.
    const holders = new Set([newSweepHolder(), newSweepHolder(), newSweepHolder()])

    expect(holders.size).toBe(3)
  })
})

describe('runReminderSweep', () => {
  it('enqueues before draining, so a reminder that just came due goes out now', async () => {
    const order: string[] = []
    const { deps } = sweepDeps({
      reminders: {
        enqueue: (rows) => {
          order.push('enqueue')
          return Promise.resolve({ queued: rows.length, skipped: 0 })
        },
      },
      drain: {
        listDue: () => {
          order.push('drain')
          return Promise.resolve([queuedRow()])
        },
      },
    })

    const result = await runReminderSweep(deps)

    expect(order).toEqual(['enqueue', 'drain'])
    expect(result.reminders).toMatchObject({ queued: 2 })
    expect(result.outbox).toMatchObject({ claimed: 1, sent: 1 })
  })

  it('claims with the holder it generated, once per row', async () => {
    const { fns, deps } = sweepDeps({})

    const result = await runReminderSweep(deps)

    expect(fns.claim).toHaveBeenCalledWith('outbox:recOut1', result.holder, expect.any(Number))
  })

  it('still drains the outbox when the reminder enqueue fails', async () => {
    // Airtable rate limiting on the Forms read must not strand acceptance mail that
    // is already queued: the two halves fail independently.
    const { fns, deps } = sweepDeps({
      reminders: {
        listForms: () =>
          Promise.reject(new AppError(ErrorIds.DATA_RATE_LIMITED, 'airtable said 429', {})),
      },
    })

    const result = await runReminderSweep(deps)

    expect(result.reminders.error).toContain(ErrorIds.DATA_RATE_LIMITED)
    expect(result.outbox).toMatchObject({ sent: 1 })
    expect(fns.send).toHaveBeenCalledTimes(1)
  })

  it('reports a drain failure as counts rather than throwing out of the sweep', async () => {
    const { deps } = sweepDeps({})
    deps.drain.send = vi
      .fn<DrainDeps['send']>()
      .mockRejectedValue(new AppError(ErrorIds.MAIL_SEND_FAIL, 'resend rejected the send', {}))

    const result = await runReminderSweep(deps)

    expect(result.outbox).toMatchObject({ failed: 1, sent: 0 })
    expect(result.reminders.error).toBeUndefined()
  })
})
