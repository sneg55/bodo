// The filter standing between an organizer's work-in-progress and the event website.

import { describe, expect, it } from 'vitest'

import type { SubmissionStatus } from '@/constants/status'
import { publicAgendaRows } from '@/features/agenda/public-agenda'

type Row = {
  id: string
  status: SubmissionStatus
  scheduleStatus: 'unscheduled' | 'scheduled' | 'published'
  calendarStatus: 'active' | 'cancelled'
  startsAt?: string
}

const row = (over: Partial<Row> & { id: string }): Row => ({
  status: 'accepted',
  scheduleStatus: 'published',
  calendarStatus: 'active',
  startsAt: '2026-10-12T17:00:00.000Z',
  ...over,
})

describe('publicAgendaRows', () => {
  it('publishes only published rows', () => {
    const rows = [
      row({ id: 'pub' }),
      row({ id: 'sched', scheduleStatus: 'scheduled' }),
      row({ id: 'tray', scheduleStatus: 'unscheduled' }),
    ]

    expect(publicAgendaRows(rows).map((r) => r.id)).toEqual(['pub'])
  })

  it('drops a cancelled session even when it is still marked published', () => {
    // A cancelled session keeping its public slot sends an audience to an empty room.
    const rows = [row({ id: 'live' }), row({ id: 'gone', calendarStatus: 'cancelled' })]

    expect(publicAgendaRows(rows).map((r) => r.id)).toEqual(['live'])
  })

  it('drops a row whose review status left accepted, however it is scheduled', () => {
    // The leak this closes. `accepted -> withdrawn` and `accepted -> decline_queue` are
    // both legal (SUBMISSION_TRANSITIONS) and `setSubmissionStatus` writes only `status`,
    // so `scheduleStatus` stays `published` and the row stayed on the public page.
    const rows = [
      row({ id: 'accepted' }),
      row({ id: 'withdrawn', status: 'withdrawn' }),
      row({ id: 'declined', status: 'declined' }),
      row({ id: 'requeued', status: 'decline_queue' }),
      row({ id: 'pending', status: 'pending' }),
      row({ id: 'draft', status: 'draft' }),
    ]

    expect(publicAgendaRows(rows).map((r) => r.id)).toEqual(['accepted'])
  })

  it('drops a reopened row before its edited body can reach the page', () => {
    // Worse than an empty room: `withdrawn -> pending` is legal and `pending` is in
    // SPEAKER_EDITABLE_STATUSES, so the speaker can rewrite the body of a submission
    // that is still marked published. Filtering on status is what keeps that private.
    expect(publicAgendaRows([row({ id: 'reopened', status: 'pending' })])).toEqual([])
  })

  it('orders by start time, because an unordered schedule is not a schedule', () => {
    const rows = [
      row({ id: 'late', startsAt: '2026-10-12T18:00:00.000Z' }),
      row({ id: 'early', startsAt: '2026-10-12T09:00:00.000Z' }),
      row({ id: 'mid', startsAt: '2026-10-12T13:00:00.000Z' }),
    ]

    expect(publicAgendaRows(rows).map((r) => r.id)).toEqual(['early', 'mid', 'late'])
  })

  it('sorts a published row with no time last rather than dropping it', () => {
    // Visible so an organizer can see the data problem. Hiding it would make the
    // page look right while a session quietly went missing.
    const rows = [row({ id: 'timeless', startsAt: undefined }), row({ id: 'timed' })]

    expect(publicAgendaRows(rows).map((r) => r.id)).toEqual(['timed', 'timeless'])
  })

  it('does not mutate the input', () => {
    const rows = [
      row({ id: 'b', startsAt: '2026-10-12T18:00:00.000Z' }),
      row({ id: 'a', startsAt: '2026-10-12T09:00:00.000Z' }),
    ]

    publicAgendaRows(rows)

    expect(rows.map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('returns nothing for an event with nothing published', () => {
    expect(publicAgendaRows([row({ id: 'x', scheduleStatus: 'scheduled' })])).toEqual([])
  })
})
