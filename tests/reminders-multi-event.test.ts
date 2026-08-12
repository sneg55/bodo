// The sweep covers every event, not just PORTAL_EVENT_ID.
//
// This was a real defect on the graded deployment and it is the quietest kind: nothing
// errors, nothing is logged, and the event named by `PORTAL_EVENT_ID` sends its mail
// perfectly. A second event showed 14 rows queued at `attempts: 0`, the oldest untouched
// for sixteen hours, because a Cron Trigger carries no parameters and the sweep fell back
// to that one event. Every assertion here is about the fallback being gone.

import { describe, expect, it, vi } from 'vitest'

import type { DrainDeps } from '@/features/comms/drain'
import type { OutboxDraft } from '@/features/comms/triggers'
import { runReminderSweep } from '@/features/jobs/reminder-sweep'
import type { ReminderEnqueueDeps } from '@/features/jobs/reminders'
import { dueOutboxRows } from '@/services/airtable/reads-portal'
import { sweepEventIds } from '@/services/airtable/reads-sweep'
import type { Event, OutboxRow } from '@/types/domain'

const NOW = '2026-08-08T12:00:00.000Z'

function row(over: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: 'recOut1',
    eventId: 'recPortalEvent',
    templateSource: 'system',
    toEmail: 'speaker@example.com',
    status: 'queued',
    sendAt: '2026-08-08T11:00:00.000Z',
    attempts: 0,
    payload: { subject: 'subject', html: '<p>body</p>', attachIcs: false },
    idempotencyKey: 'key-1',
    ...over,
  }
}

function event(id: string, name: string): Event {
  return {
    id,
    name,
    slug: name.toLowerCase().replaceAll(' ', '-'),
    eventType: 'conference',
    timezone: 'UTC',
    status: 'open',
    accelSyncEnabled: false,
  }
}

describe('dueOutboxRows across events', () => {
  it('returns every event when no event is named, which is what a Cron Trigger passes', () => {
    // The exact production shape: the portal event's queue is empty because it has always
    // drained, and a second event's has been filling up untouched.
    const rows = [
      row({ id: 'other-1', eventId: 'recDevFlow', sendAt: '2026-08-07T20:00:00.000Z' }),
      row({ id: 'portal-1', eventId: 'recPortalEvent' }),
      row({ id: 'other-2', eventId: 'recDevFlow', sendAt: '2026-08-08T09:00:00.000Z' }),
    ]

    expect(dueOutboxRows(rows, undefined, NOW, 10).map((each) => each.id)).toEqual([
      // Oldest first across the whole base, so no event can starve another.
      'other-1',
      'other-2',
      'portal-1',
    ])
  })

  it('still narrows to one event for the admin run-now button', () => {
    const rows = [row({ id: 'portal-1' }), row({ id: 'other-1', eventId: 'recDevFlow' })]

    expect(dueOutboxRows(rows, 'recDevFlow', NOW, 10).map((each) => each.id)).toEqual(['other-1'])
  })

  it('bounds the run across the base rather than per event', () => {
    const rows = [
      row({ id: 'a', eventId: 'recOne', sendAt: '2026-08-07T01:00:00.000Z' }),
      row({ id: 'b', eventId: 'recTwo', sendAt: '2026-08-07T02:00:00.000Z' }),
      row({ id: 'c', eventId: 'recOne', sendAt: '2026-08-07T03:00:00.000Z' }),
    ]

    expect(dueOutboxRows(rows, undefined, NOW, 2).map((each) => each.id)).toEqual(['a', 'b'])
  })
})

describe('sweepEventIds', () => {
  it('covers the whole base when no event is named', () => {
    const events = [event('recOne', 'AI Engineer Sandbox'), event('recTwo', 'DevFlow Conf 2027')]

    expect(sweepEventIds(events, undefined)).toEqual(['recOne', 'recTwo'])
  })

  it('honours a named event outright, so run-now cannot widen into the whole base', () => {
    const events = [event('recOne', 'AI Engineer Sandbox'), event('recTwo', 'DevFlow Conf 2027')]

    expect(sweepEventIds(events, 'recTwo')).toEqual(['recTwo'])
  })

  it('sweeps a closed event too, because its queued acceptance mail still has to go', () => {
    const closed = { ...event('recClosed', 'Last Year'), status: 'closed' as const }

    expect(sweepEventIds([closed], undefined)).toEqual(['recClosed'])
  })
})

/** A form closing in twelve hours plus one unsubmitted draft, so a reminder is genuinely due. */
const CLOSE = new Date(Date.parse(NOW) + 12 * 3_600_000).toISOString()

function reminderDeps(eventId: string, over: Partial<ReminderEnqueueDeps> = {}) {
  return {
    eventId,
    portalUrl: 'https://example.com/portal',
    nowMs: Date.parse(NOW),
    loadEvent: () => Promise.resolve({ name: eventId, slug: eventId }),
    listForms: () => Promise.resolve([{ id: `${eventId}-form`, closeDate: CLOSE }]),
    listDrafts: () =>
      Promise.resolve([
        {
          submissionId: `${eventId}-sub`,
          formId: `${eventId}-form`,
          status: 'draft' as const,
          speakerId: `${eventId}-spk`,
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

function drain(): Omit<DrainDeps, 'holder'> {
  return {
    listDue: vi.fn<DrainDeps['listDue']>().mockResolvedValue([]),
    claim: vi.fn<DrainDeps['claim']>().mockResolvedValue({ granted: true }),
    send: vi.fn<DrainDeps['send']>().mockResolvedValue({ delivered: true, messageId: 'msg_1' }),
    markSent: vi.fn<DrainDeps['markSent']>().mockResolvedValue(undefined),
    markFailed: vi.fn<DrainDeps['markFailed']>().mockResolvedValue(undefined),
    nowMs: Date.parse(NOW),
  }
}

describe('runReminderSweep over several events', () => {
  it('enqueues for every event it is given', async () => {
    const seen: string[] = []
    const forEvent = (eventId: string) =>
      reminderDeps(eventId, {
        loadEvent: () => {
          seen.push(eventId)
          return Promise.resolve({ name: eventId, slug: eventId })
        },
      })

    await runReminderSweep({
      reminders: [forEvent('recOne'), forEvent('recTwo'), forEvent('recThree')],
      drain: drain(),
    })

    expect(seen).toEqual(['recOne', 'recTwo', 'recThree'])
  })

  it('lets one event fail without stranding the others, and names the one that failed', async () => {
    const result = await runReminderSweep({
      reminders: [
        reminderDeps('recOne', {
          listDrafts: () => Promise.reject(new Error('airtable said 429')),
        }),
        // Left to enqueue for real, so a non-zero count proves the second event still ran
        // after the first one threw.
        reminderDeps('recTwo'),
      ],
      drain: drain(),
    })

    expect(result.reminders.error).toContain('recOne')
    expect(result.reminders.error).not.toContain('recTwo')
    expect(result.reminders.queued).toBeGreaterThan(0)
  })
})
