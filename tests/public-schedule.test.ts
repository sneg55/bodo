// The public agenda's shape: which rows reach it, and how they are grouped and labelled.
//
// The filter itself is pinned in public-agenda.test.ts. What is pinned here is everything
// between that filter and the page: day grouping in the EVENT's timezone (a 7pm session
// belongs to the evening a visitor is standing in, not to tomorrow in UTC), the resolved
// room and track names, and the fact that a published row with no time is still shown.

import { describe, expect, it } from 'vitest'

import {
  groupPublicSchedule,
  type PublicScheduleRow,
  UNDATED_DAY_KEY,
  UNDATED_DAY_LABEL,
} from '@/features/agenda/public-schedule'
import { FIXTURE_ROOMS, FIXTURE_SUBMISSIONS, FIXTURE_TRACKS } from '@/services/airtable/fixtures'
import { getEventBySlug, listPublishedAgenda } from '@/services/airtable/queries'
import { hasAirtable } from '@/utils/env'

const ZONE = 'America/Los_Angeles'
const LOOKUPS = { rooms: FIXTURE_ROOMS, tracks: FIXTURE_TRACKS }

const row = (over: Partial<PublicScheduleRow> & { id: string }): PublicScheduleRow => ({
  title: `Session ${over.id}`,
  startsAt: '2026-10-12T17:00:00.000Z',
  endsAt: '2026-10-12T17:30:00.000Z',
  participants: [],
  ...over,
})

describe('groupPublicSchedule', () => {
  it('groups by day in the event timezone rather than in UTC', () => {
    // 02:00 UTC on the 13th is 7pm on the 12th in California, so both of these belong
    // to the same conference day. Grouping on the ISO string would split them.
    const days = groupPublicSchedule(
      [
        row({ id: 'morning' }),
        row({ id: 'evening', startsAt: '2026-10-13T02:00:00.000Z', endsAt: undefined }),
      ],
      LOOKUPS,
      ZONE,
    )

    expect(days).toHaveLength(1)
    expect(days[0]?.key).toBe('2026-10-12')
    expect(days[0]?.label).toBe('Monday, October 12')
    expect(days[0]?.sessions.map((session) => session.id)).toEqual(['morning', 'evening'])
  })

  it('keeps the order it was handed, which is the published start order', () => {
    // The sort belongs to publicAgendaRows, so grouping must not reshuffle: a day
    // appears where its first session appears.
    const days = groupPublicSchedule(
      [
        row({ id: 'day-one' }),
        row({ id: 'day-two', startsAt: '2026-10-13T17:00:00.000Z', endsAt: undefined }),
        row({ id: 'day-one-later', startsAt: '2026-10-12T20:00:00.000Z', endsAt: undefined }),
      ],
      LOOKUPS,
      ZONE,
    )

    expect(days.map((day) => day.key)).toEqual(['2026-10-12', '2026-10-13'])
    expect(days[0]?.sessions.map((session) => session.id)).toEqual(['day-one', 'day-one-later'])
  })

  it('resolves room and track names and joins each speaker name', () => {
    const days = groupPublicSchedule(
      [
        row({
          id: 'one',
          title: 'Evaluating agents without a golden dataset',
          roomId: 'fixRoom1',
          trackId: 'fixTrack2',
          participants: [
            { speaker: { firstName: 'Ada', lastName: 'Lovelace' } },
            { speaker: { firstName: 'Grace', lastName: 'Hopper' } },
          ],
        }),
      ],
      LOOKUPS,
      ZONE,
    )

    expect(days[0]?.sessions[0]).toMatchObject({
      title: 'Evaluating agents without a golden dataset',
      room: 'Main Stage',
      track: 'Evals',
      speakers: ['Ada Lovelace', 'Grace Hopper'],
    })
  })

  it('leaves a room or track that no longer exists out instead of printing an id', () => {
    const days = groupPublicSchedule(
      [row({ id: 'one', roomId: 'recGone', trackId: 'recAlsoGone' })],
      LOOKUPS,
      ZONE,
    )

    expect(days[0]?.sessions[0]?.room).toBeUndefined()
    expect(days[0]?.sessions[0]?.track).toBeUndefined()
  })

  it('labels a slot with its start and end time in the event timezone', () => {
    const days = groupPublicSchedule([row({ id: 'one' })], LOOKUPS, ZONE)

    expect(days[0]?.sessions[0]?.time).toBe('10:00 AM - 10:30 AM')
  })

  it('does not print a daylight-saving range backwards', () => {
    // A local time of day is not a total order over instants. On the fall-back night the
    // 1am hour happens twice, so this 30-minute session rendered as `1:45 AM - 1:15 AM`,
    // which reads as a bug rather than as a real session. The abbreviation is the only
    // thing that separates the two passes through that hour.
    const days = groupPublicSchedule(
      [
        row({
          id: 'repeated-hour',
          startsAt: '2026-11-01T05:45:00.000Z',
          endsAt: '2026-11-01T06:15:00.000Z',
        }),
      ],
      LOOKUPS,
      'America/New_York',
    )

    expect(days[0]?.sessions[0]?.time).toBe('1:45 AM EDT - 1:15 AM EST')
  })

  it('names the day when a slot runs past midnight', () => {
    // The other way a bare range inverts, and a date is what distinguishes this one: the
    // abbreviations would both read EST and explain nothing.
    const days = groupPublicSchedule(
      [
        row({
          id: 'late-night',
          startsAt: '2026-11-03T04:30:00.000Z',
          endsAt: '2026-11-03T05:30:00.000Z',
        }),
      ],
      LOOKUPS,
      'America/New_York',
    )

    expect(days[0]?.sessions[0]?.time).toBe('11:30 PM - 12:30 AM (Nov 3)')
  })

  it('labels a slot with no end time by its start alone', () => {
    const days = groupPublicSchedule([row({ id: 'one', endsAt: undefined })], LOOKUPS, ZONE)

    expect(days[0]?.sessions[0]?.time).toBe('10:00 AM')
  })

  it('shows a published session with no start time in a trailing group', () => {
    // publicAgendaRows sorts these last rather than dropping them, so the page has to
    // have somewhere to put them. Hiding one would make the agenda look complete while
    // a session quietly went missing.
    const days = groupPublicSchedule(
      [row({ id: 'timed' }), row({ id: 'timeless', startsAt: undefined, endsAt: undefined })],
      LOOKUPS,
      ZONE,
    )

    expect(days.map((day) => day.key)).toEqual(['2026-10-12', UNDATED_DAY_KEY])
    expect(days[1]?.label).toBe(UNDATED_DAY_LABEL)
    expect(days[1]?.sessions[0]?.time).toBeUndefined()
  })

  it('produces no days at all when nothing is published, so the page can say so', () => {
    expect(groupPublicSchedule([], LOOKUPS, ZONE)).toEqual([])
  })
})

describe('the reads the public agenda page depends on, on the fixture source', () => {
  it('is the branch under test', () => {
    // Guards the rest: with credentials present these would reach Airtable and the
    // failures would read as logic bugs.
    expect(hasAirtable()).toBe(false)
  })

  it('resolves an event from the slug the public URL carries', async () => {
    expect((await getEventBySlug('ai-engineer-sandbox'))?.id).toBe('fixEvent1')
  })

  it('answers undefined for an unknown slug, which the page turns into a 404', async () => {
    expect(await getEventBySlug('not-a-real-event')).toBeUndefined()
  })

  it('keeps a scheduled but unpublished session off the public agenda', async () => {
    // The fixtures schedule two sessions into a room and a time without publishing
    // them, which is exactly the half-built schedule the third state exists to hide.
    const scheduled = FIXTURE_SUBMISSIONS.filter((row) => row.scheduleStatus === 'scheduled')
    expect(scheduled.length).toBeGreaterThan(0)

    expect(await listPublishedAgenda('fixEvent1')).toEqual([])
  })
})
