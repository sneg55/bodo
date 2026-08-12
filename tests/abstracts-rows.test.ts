import { describe, expect, it } from 'vitest'

import { registryField } from '@/constants/fields'
import {
  hasNumericSort,
  rowNumber,
  rowText,
  SORTABLE_ROW_KEYS,
} from '@/features/review/abstracts-accessors'
import {
  buildAbstractRows,
  MANUAL_DESCRIPTION_KEY,
  MANUAL_SOURCE_LABEL,
} from '@/features/review/abstracts-rows'
import type { RatingCell } from '@/features/review/ratings'
import type { Room, SubmissionWithParticipants, Tag, Track } from '@/types/domain'
import type { Form, FormField } from '@/types/forms'

const TRACKS: readonly Track[] = [
  { id: 'trk1', eventId: 'ev1', name: 'Agents', color: '#111111', order: 1 },
]
const TAGS: readonly Tag[] = [{ id: 'tag1', eventId: 'ev1', name: 'Live Demo', color: '#222222' }]
const ROOMS: readonly Room[] = [{ id: 'room1', eventId: 'ev1', name: 'Main Stage', order: 1 }]

const DESCRIPTION_FIELD = {
  id: 'fld_desc',
  type: 'wysiwyg',
  label: 'Description',
  required: false,
  registryKey: 'description',
} as unknown as FormField

const FORM = {
  id: 'form1',
  eventId: 'ev1',
  name: 'Session Submission Form',
  fields: [DESCRIPTION_FIELD],
} as unknown as Form

function submission(
  overrides: Partial<SubmissionWithParticipants> & { id: string },
): SubmissionWithParticipants {
  return {
    eventId: 'ev1',
    formId: 'form1',
    submitterId: 'spk1',
    code: 'SESS-1',
    title: 'A talk',
    status: 'pending',
    source: 'form',
    reviewRequired: true,
    answers: {},
    tagIds: [],
    scheduleStatus: 'unscheduled',
    contentStatus: 'not_submitted',
    calendarSequence: 0,
    calendarStatus: 'active',
    participants: [],
    ...overrides,
  }
}

const LOOKUPS = {
  tracks: TRACKS,
  tags: TAGS,
  rooms: ROOMS,
  forms: [FORM],
  ratings: new Map<string, RatingCell>([
    [
      's1',
      { kind: 'scored', percent: 84, reviewCount: 3, recommendations: { yes: 3, no: 0, maybe: 0 } },
    ],
  ]),
  timeZone: 'UTC',
}

describe('buildAbstractRows', () => {
  it('resolves the Source chip from the originating form, and Manual when there is none', () => {
    const [fromForm, manual] = buildAbstractRows(
      [submission({ id: 's1' }), submission({ id: 's2', formId: undefined, source: 'manual' })],
      LOOKUPS,
    )
    expect(fromForm.sourceLabel).toBe('Session Submission Form')
    expect(manual.sourceLabel).toBe(MANUAL_SOURCE_LABEL)
  })

  it('reads Description through the form field the registry key points at', () => {
    const [row] = buildAbstractRows(
      [submission({ id: 's1', answers: { fld_desc: '<p>Hello <b>world</b></p>' } })],
      LOOKUPS,
    )
    // Flattened, so a table row never renders submitter-supplied HTML.
    expect(row.description).toBe('Hello world')
  })

  it('reads a manually added abstract description from the registry key itself', () => {
    const [row] = buildAbstractRows(
      [
        submission({
          id: 's1',
          formId: undefined,
          answers: { [MANUAL_DESCRIPTION_KEY]: 'Typed by an organizer' },
        }),
      ],
      LOOKUPS,
    )
    expect(row.description).toBe('Typed by an organizer')
  })

  it('joins track, tags, and room through the event lookups', () => {
    const [row] = buildAbstractRows(
      [submission({ id: 's1', trackId: 'trk1', tagIds: ['tag1', 'missing'], roomId: 'room1' })],
      LOOKUPS,
    )
    expect(row.track).toEqual({ id: 'trk1', name: 'Agents', color: '#111111' })
    // A tag id pointing at nothing is dropped rather than rendered as a blank chip.
    expect(row.tags).toHaveLength(1)
    expect(row.roomName).toBe('Main Stage')
  })

  it('formats dates on the server and keeps the ISO value for sorting', () => {
    const [row] = buildAbstractRows(
      [submission({ id: 's1', notifiedAt: '2026-08-06T12:00:00.000Z' })],
      LOOKUPS,
    )
    expect(row.notifiedAt).toBe('2026-08-06T12:00:00.000Z')
    expect(row.dates.notifiedAt).toContain('2026')
    expect(row.dates.submittedAt).toBe('')
  })

  it('names every participant and takes the submitter email from the primary one', () => {
    const [row] = buildAbstractRows(
      [
        submission({
          id: 's1',
          participants: [
            {
              id: 'p1',
              submissionId: 's1',
              speakerId: 'spk1',
              role: 'speaker',
              isPrimary: true,
              sortOrder: 1,
              speaker: {
                id: 'spk1',
                email: 'ada@example.com',
                firstName: 'Ada',
                lastName: 'Okafor',
                links: {},
              },
            },
          ],
        }),
      ],
      LOOKUPS,
    )
    expect(row.speakers).toEqual(['Ada Okafor'])
    expect(row.submitterEmail).toBe('ada@example.com')
    // No chairperson on this submission, and an empty list rather than undefined: the
    // Chairperson column renders "-" from an empty value.
    expect(row.chairpersons).toEqual([])
  })

  it('derives the Chairperson column from the participant role, not from a new column', () => {
    const person = (id: string, first: string, role: 'speaker' | 'chairperson', order: number) => ({
      id: `p${order}`,
      submissionId: 's1',
      speakerId: id,
      role,
      isPrimary: order === 1,
      sortOrder: order,
      speaker: {
        id,
        email: `${first}@example.com`,
        firstName: first,
        lastName: 'Okafor',
        links: {},
      },
    })

    const [row] = buildAbstractRows(
      [
        submission({
          id: 's1',
          participants: [
            person('spk1', 'Ada', 'speaker', 1),
            person('spk2', 'Chen', 'chairperson', 2),
          ],
        }),
      ],
      LOOKUPS,
    )

    expect(row.chairpersons).toEqual(['Chen Okafor'])
    // Still counted as a participant: the role narrows the column, it does not remove
    // anyone from the cast.
    expect(row.speakers).toEqual(['Ada Okafor', 'Chen Okafor'])
    expect(rowText(row, 'chairperson')).toBe('Chen Okafor')
  })
})

describe('row accessors', () => {
  const [row] = buildAbstractRows(
    [submission({ id: 's1', trackId: 'trk1', ceuCredits: 2, capacity: 90 })],
    LOOKUPS,
  )

  it('reads text through the registry key, and misses on a key it does not render', () => {
    expect(rowText(row, 'title')).toBe('A talk')
    expect(rowText(row, 'track')).toBe('Agents')
    expect(rowText(row, 'nonsense')).toBeUndefined()
  })

  it('exposes numeric columns as numbers so 9 does not sort after 10', () => {
    expect(rowNumber(row, 'capacity')).toBe(90)
    expect(rowNumber(row, 'ceuCredits')).toBe(2)
    expect(rowNumber(row, 'title')).toBeUndefined()
  })

  it('declares which columns sort numerically without having to read a row first', () => {
    expect(hasNumericSort('ratings')).toBe(true)
    expect(hasNumericSort('title')).toBe(false)
  })

  it('offers Ratings as sortable, which is the column the registry flag was hiding', () => {
    // `ratings` is `column: false` in the field registry, because it is derived from
    // Reviews and has no Submissions column. The Sort and Filter panes used to read that
    // flag, so the one column an organizer most wants to rank by was never offered.
    expect(SORTABLE_ROW_KEYS.has('ratings')).toBe(true)
    expect(registryField('ratings')?.column).toBe(false)
  })

  it('offers exactly the keys an accessor can answer, and nothing else', () => {
    // A key with no accessor would be a sort that visibly does nothing and a filter that
    // matches every row, so the set is derived from the accessor maps rather than listed.
    for (const key of SORTABLE_ROW_KEYS) {
      expect(rowText(row, key) ?? rowNumber(row, key)).toBeDefined()
    }
    expect(SORTABLE_ROW_KEYS.has('nonsense')).toBe(false)
  })
})
