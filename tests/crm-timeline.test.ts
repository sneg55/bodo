// The CRM profile's communication timeline: what an organizer sees under Communication.
//
// Pure, so it is assertable without a base. The rules worth pinning are the ordering
// (newest first, by the one timestamp every row carries), that an UNSENT row still shows
// up, that a subject always renders as something, and that every rendered row is on ONE
// clock which it names. The last one is the eval finding of 2026-08-10; see `timelineRows`
// and `profileTimezone`.

import { describe, expect, it } from 'vitest'

import type { OutboxStatus } from '@/constants/status'
import { scopedOutbox, speakerTimeline, timelineRows } from '@/features/crm/timeline'
import type { OutboxRow } from '@/types/domain'

/**
 * One outbox row.
 *
 * The brief's helper used `'pending'` for the unsent case, which is not an
 * `OutboxStatus`: the vocabulary is `queued | sending | sent | failed | dead`
 * (`src/constants/status.ts`). `'queued'` is the state it meant, and it is what the
 * test name already says.
 */
const row = (id: string, sendAt: string, status: OutboxStatus, subject = `Subject ${id}`) =>
  ({
    id,
    eventId: 'e1',
    speakerId: 'spk1',
    templateSource: 'template',
    idempotencyKey: id,
    payload: { subject, html: '<p>Hi</p>', attachIcs: false },
    toEmail: 'ada@example.com',
    sendAt,
    status,
    attempts: 0,
  }) satisfies OutboxRow

describe('speakerTimeline', () => {
  it('orders newest first', () => {
    const entries = speakerTimeline([
      row('a', '2026-01-01T00:00:00.000Z', 'sent'),
      row('b', '2026-03-01T00:00:00.000Z', 'sent'),
    ])
    expect(entries.map((entry) => entry.id)).toEqual(['b', 'a'])
  })

  it('keeps unsent rows, so a queued mail is visible', () => {
    expect(speakerTimeline([row('a', '2026-01-01T00:00:00.000Z', 'queued')])).toHaveLength(1)
  })

  it('is empty for a speaker who has been sent nothing', () => {
    expect(speakerTimeline([])).toEqual([])
  })

  it('keeps every status, including the ones a drain gave up on', () => {
    const statuses: readonly OutboxStatus[] = ['queued', 'sending', 'sent', 'failed', 'dead']
    const entries = speakerTimeline(
      statuses.map((status, index) => row(status, `2026-01-0${index + 1}T00:00:00.000Z`, status)),
    )
    expect(entries.map((entry) => entry.status)).toEqual([...statuses].reverse())
  })

  it('projects the subject out of the payload', () => {
    const entries = speakerTimeline([row('a', '2026-01-01T00:00:00.000Z', 'sent', 'You are in')])
    expect(entries.map((entry) => entry.subject)).toEqual(['You are in'])
  })

  it('falls back to a placeholder for a blank subject, so a row is never a blank line', () => {
    const entries = speakerTimeline([row('a', '2026-01-01T00:00:00.000Z', 'sent', '   ')])
    expect(entries.map((entry) => entry.subject)).toEqual(['(no subject)'])
  })

  it('carries the event, because the timeline is cross-event', () => {
    const entries = speakerTimeline([
      { ...row('a', '2026-01-01T00:00:00.000Z', 'sent'), eventId: 'e2' },
    ])
    expect(entries.map((entry) => entry.eventId)).toEqual(['e2'])
  })

  it('carries sentAt without sorting on it, so a late send keeps its queued position', () => {
    // `b` was DUE first and DELIVERED second. Ordering is on `sendAt`, so it stays first.
    const entries = speakerTimeline([
      { ...row('a', '2026-01-02T00:00:00.000Z', 'sent'), sentAt: '2026-01-02T00:00:05.000Z' },
      { ...row('b', '2026-01-03T00:00:00.000Z', 'sent'), sentAt: '2026-01-09T00:00:00.000Z' },
    ])
    expect(entries.map((entry) => entry.id)).toEqual(['b', 'a'])
    expect(entries.map((entry) => entry.at)).toEqual([
      '2026-01-03T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
    ])
  })

  it('leaves sentAt absent on a row that has not gone out', () => {
    const entries = speakerTimeline([row('a', '2026-01-01T00:00:00.000Z', 'queued')])
    expect(entries.map((entry) => entry.sentAt)).toEqual([undefined])
  })

  it('is a stable sort, so two mails sent in the same minute keep the reader order', () => {
    const entries = speakerTimeline([
      row('a', '2026-01-01T00:00:00.000Z', 'sent'),
      row('b', '2026-01-01T00:00:00.000Z', 'sent'),
    ])
    expect(entries.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('does not mutate the array it was handed, which is a cached read', () => {
    const rows = [
      row('a', '2026-01-01T00:00:00.000Z', 'sent'),
      row('b', '2026-03-01T00:00:00.000Z', 'sent'),
    ]
    speakerTimeline(rows)
    expect(rows.map((entry) => entry.id)).toEqual(['a', 'b'])
  })
})

describe('timelineRows', () => {
  const entry = {
    id: 'o1',
    subject: 'Hello',
    status: 'sent' as const,
    at: '2026-03-01T18:30:00.000Z',
    eventId: 'e1',
  }

  // The shape the eval run of 2026-08-10 filed: a contact on two events in different zones.
  // Every row must land on the FIRST event's clock however many events the list spans.
  const events = [
    { id: 'e1', name: 'DevFlow Conf 2027' },
    { id: 'e2', name: 'AI Engineer Sandbox' },
  ]
  const ZONE = 'America/Los_Angeles'

  it("renders in the profile's zone and names it", () => {
    const [row] = timelineRows([entry], events, ZONE)
    expect(row).toMatchObject({
      eventName: 'DevFlow Conf 2027',
      atText: 'Mar 1, 2026, 10:30 AM PST',
    })
  })

  it('puts a second event’s mail on the same clock, not on that event’s own', () => {
    // This is the regression. Before the fix the second row rendered in `e2`'s own zone, so
    // two mails half an hour apart read as eight hours apart with nothing saying why.
    const rows = timelineRows(
      [entry, { ...entry, id: 'o2', eventId: 'e2', at: '2026-03-01T19:00:00.000Z' }],
      events,
      ZONE,
    )
    expect(rows.map((row) => row.atText)).toEqual([
      'Mar 1, 2026, 10:30 AM PST',
      'Mar 1, 2026, 11:00 AM PST',
    ])
    expect(rows.map((row) => row.eventName)).toEqual(['DevFlow Conf 2027', 'AI Engineer Sandbox'])
  })

  it('keeps a row whose event is not on the profile, on the same clock as the rest', () => {
    // It loses its NAME, because there is no event to name it after, and it keeps the
    // profile's clock. It used to silently claim UTC, which is what made the skew invisible.
    const [row] = timelineRows([{ ...entry, eventId: 'e9' }], events, ZONE)
    expect(row).toMatchObject({ eventName: undefined, atText: 'Mar 1, 2026, 10:30 AM PST' })
  })

  it('names the UTC fallback out loud rather than passing it off as local time', () => {
    // The zone a contact on no event at all falls back to. Nothing here decides that (see
    // `profileTimezone`); what is pinned is that the reader is told.
    const [row] = timelineRows([entry], [], 'UTC')
    expect(row.atText).toBe('Mar 1, 2026, 6:30 PM UTC')
  })

  it('follows daylight saving per row rather than labelling the whole list once', () => {
    const rows = timelineRows(
      [entry, { ...entry, id: 'o2', at: '2026-08-01T18:30:00.000Z' }],
      events,
      ZONE,
    )
    expect(rows.map((row) => row.atText)).toEqual([
      'Mar 1, 2026, 10:30 AM PST',
      'Aug 1, 2026, 11:30 AM PDT',
    ])
  })

  it('shows the send beside the schedule when the two are different minutes', () => {
    const [row] = timelineRows([{ ...entry, sentAt: '2026-03-02T00:15:00.000Z' }], events, ZONE)
    expect(row).toMatchObject({
      atText: 'Mar 1, 2026, 10:30 AM PST',
      sentAtText: 'Mar 1, 2026, 4:15 PM PST',
    })
  })

  it('drops the send when it renders the same as the schedule, which is the common case', () => {
    // Enqueued with `sendAt: now` and drained seconds later. Two identical strings under two
    // labels would be noise on almost every row in the list.
    const [row] = timelineRows([{ ...entry, sentAt: '2026-03-01T18:30:20.000Z' }], events, ZONE)
    expect(row.sentAtText).toBeUndefined()
  })

  it('leaves sentAtText absent on a queued row, which has no send to show', () => {
    const [row] = timelineRows([{ ...entry, status: 'queued' as const }], events, ZONE)
    expect(row.sentAtText).toBeUndefined()
  })
})

describe('scopedOutbox', () => {
  const at = '2026-01-01T00:00:00.000Z'

  it("drops mail sent for another organizer's event", () => {
    const rows = [row('mine', at, 'sent'), { ...row('theirs', at, 'sent'), eventId: 'e9' }]
    expect(scopedOutbox(rows, ['e1']).map((entry) => entry.id)).toEqual(['mine'])
  })

  it('keeps mail for an event in scope the speaker is no longer linked to', () => {
    const rows = [{ ...row('unlinked', at, 'sent'), eventId: 'e2' }]
    expect(scopedOutbox(rows, ['e1', 'e2'])).toHaveLength(1)
  })

  it('is empty for a viewer with no scope at all', () => {
    expect(scopedOutbox([row('a', at, 'sent')], [])).toEqual([])
  })
})
