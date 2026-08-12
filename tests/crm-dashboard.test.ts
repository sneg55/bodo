// The CRM dashboard's aggregation. Every number on that page is decided here, so the
// assertions are about the rules that are easy to get quietly wrong: which rows survive at
// zero, which list is ranked and which is not, and what the trailing month window covers.

import { describe, expect, it } from 'vitest'
import type { SpeakerStatus } from '@/constants/status'
import { buildCrmDashboard, type CrmDashboardInput, invitesByMonth } from '@/features/crm/dashboard'
import type { SpeakerInEvents } from '@/types/crm'
import type { Speaker, SpeakerTag } from '@/types/domain'

const NOW = new Date('2026-08-10T00:00:00.000Z')

const speaker = (id: string, over: Partial<Speaker> = {}): Speaker => ({
  id,
  email: `${id}@example.com`,
  firstName: 'Ada',
  lastName: id.toUpperCase(),
  links: {},
  ...over,
})

const entry = (
  id: string,
  eventIds: readonly string[],
  over: Partial<Speaker> = {},
): SpeakerInEvents => ({ speaker: speaker(id, over), eventIds })

const tag = (id: string, name: string): SpeakerTag => ({ id, name, color: '#000' })

const input = (over: Partial<CrmDashboardInput> = {}): CrmDashboardInput => ({
  speakers: [entry('s1', ['e1']), entry('s2', ['e1', 'e2'])],
  sessionCounts: new Map([['s1', 2]]),
  tagsBySpeaker: new Map(),
  eventNames: new Map([
    ['e1', 'Spring Summit'],
    ['e2', 'Autumn Forum'],
  ]),
  clusters: [],
  now: NOW,
  ...over,
})

describe('buildCrmDashboard totals', () => {
  it('counts the speakers, the events and the session slots', () => {
    const view = buildCrmDashboard(input())

    expect(view.speakerCount).toBe(2)
    expect(view.eventCount).toBe(2)
    expect(view.sessionCount).toBe(2)
    expect(view.activeSpeakerCount).toBe(1)
  })

  it('counts a person once per event they are on, not once overall', () => {
    const view = buildCrmDashboard(input())
    const counts = new Map(view.byEvent.map((row) => [row.id, row.count]))

    expect(counts.get('e1')).toBe(2)
    expect(counts.get('e2')).toBe(1)
  })

  it('keeps an event with no speakers, which is the most actionable row on the page', () => {
    const view = buildCrmDashboard(
      input({
        speakers: [entry('s1', ['e1'])],
        eventNames: new Map([
          ['e1', 'Spring Summit'],
          ['e2', 'Autumn Forum'],
        ]),
      }),
    )

    expect(view.byEvent.map((row) => [row.label, row.count])).toContainEqual(['Autumn Forum', 0])
  })

  it('ranks events by size, largest first', () => {
    const view = buildCrmDashboard(input())

    expect(view.byEvent.at(0)?.id).toBe('e1')
  })

  it('reports the duplicate count off the clusters it was handed', () => {
    const view = buildCrmDashboard(
      input({
        clusters: [
          { speakerIds: ['s1', 's2'], reason: 'name', label: 'Ada S1' },
          { speakerIds: ['s3', 's4', 's5'], reason: 'email', label: 'Bo' },
        ],
      }),
    )

    expect(view.duplicateClusters).toBe(2)
    expect(view.duplicateRecords).toBe(5)
  })
})

describe('the status mix', () => {
  it('lists all five stages even at zero, because a stage missing reads as non-existent', () => {
    const view = buildCrmDashboard(input())

    expect(view.byStatus.map((row) => row.id)).toEqual([
      'prospect',
      'invited',
      'confirmed',
      'declined',
      'cancelled',
    ])
  })

  it('counts a record with no status as a prospect', () => {
    const view = buildCrmDashboard(input())
    const prospects = view.byStatus.find((row) => row.id === 'prospect')

    expect(prospects?.count).toBe(2)
    expect(prospects?.percent).toBe(100)
  })

  it('keeps the pipeline order rather than sorting by size', () => {
    const confirmed: Partial<Speaker> = { status: 'confirmed' satisfies SpeakerStatus }
    const view = buildCrmDashboard(
      input({ speakers: [entry('s1', ['e1'], confirmed), entry('s2', ['e1'], confirmed)] }),
    )

    expect(view.byStatus.at(0)?.id).toBe('prospect')
    expect(view.byStatus.at(0)?.count).toBe(0)
  })
})

describe('the tag mix', () => {
  it('ranks the tags actually applied and leaves unused vocabulary out', () => {
    const view = buildCrmDashboard(
      input({
        tagsBySpeaker: new Map([
          ['s1', [tag('t1', 'Keynote'), tag('t2', 'Local')]],
          ['s2', [tag('t1', 'Keynote')]],
        ]),
      }),
    )

    expect(view.byTag.map((row) => [row.label, row.count])).toEqual([
      ['Keynote', 2],
      ['Local', 1],
    ])
  })

  it('is empty when nobody is tagged, so the card can say so', () => {
    expect(buildCrmDashboard(input()).byTag).toEqual([])
  })
})

describe('profile completeness', () => {
  it('counts only a non-blank value, so a field of spaces is not a headshot', () => {
    const view = buildCrmDashboard(
      input({
        speakers: [
          entry('s1', ['e1'], { headshotUrl: 'https://x/1.png', bio: '<p>hi</p>' }),
          entry('s2', ['e1'], { headshotUrl: '   ' }),
        ],
      }),
    )
    const counts = new Map(view.completeness.map((row) => [row.id, row.count]))

    expect(counts.get('headshot')).toBe(1)
    expect(counts.get('bio')).toBe(1)
    expect(counts.get('company')).toBe(0)
  })

  it('holds a fixed order so the page can be compared with itself', () => {
    expect(buildCrmDashboard(input()).completeness.map((row) => row.id)).toEqual([
      'headshot',
      'bio',
      'company',
    ])
  })
})

describe('invitesByMonth', () => {
  it('returns nothing at all when no invitation has ever been sent', () => {
    expect(invitesByMonth([entry('s1', ['e1'])], NOW)).toEqual([])
  })

  it('covers twelve months ending with the current one', () => {
    const points = invitesByMonth([entry('s1', ['e1'], { invitedAt: '2026-08-01T09:00:00Z' })], NOW)

    expect(points).toHaveLength(12)
    expect(points.at(0)?.month).toBe('2025-09')
    expect(points.at(-1)?.month).toBe('2026-08')
  })

  it('buckets by month and keeps the empty months in the series', () => {
    const points = invitesByMonth(
      [
        entry('s1', ['e1'], { invitedAt: '2026-06-02T09:00:00Z' }),
        entry('s2', ['e1'], { invitedAt: '2026-06-28T23:00:00Z' }),
        entry('s3', ['e1'], { invitedAt: '2026-08-01T09:00:00Z' }),
      ],
      NOW,
    )
    const counts = new Map(points.map((point) => [point.month, point.count]))

    expect(counts.get('2026-06')).toBe(2)
    expect(counts.get('2026-07')).toBe(0)
    expect(counts.get('2026-08')).toBe(1)
  })

  it('ignores an invitation older than the window rather than folding it into month one', () => {
    const points = invitesByMonth([entry('s1', ['e1'], { invitedAt: '2024-01-01T00:00:00Z' })], NOW)

    expect(points.every((point) => point.count === 0)).toBe(true)
  })

  it('ignores an unparseable timestamp instead of throwing', () => {
    expect(invitesByMonth([entry('s1', ['e1'], { invitedAt: 'soon' })], NOW)).toEqual([])
  })
})

describe('top speakers', () => {
  it('lists only people cast on a session, most sessions first', () => {
    const view = buildCrmDashboard(
      input({
        sessionCounts: new Map([
          ['s1', 1],
          ['s2', 4],
        ]),
      }),
    )

    expect(view.topSpeakers.map((row) => row.id)).toEqual(['s2', 's1'])
  })

  it('leaves out contacts with no sessions at all', () => {
    expect(buildCrmDashboard(input()).topSpeakers.map((row) => row.id)).toEqual(['s1'])
  })
})
