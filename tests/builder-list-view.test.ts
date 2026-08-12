// The forms list's three numbers, its tabs, and its default sort.
//
// The counts are the reason this is tested rather than eyeballed: the bubble is PENDING,
// the first stat is TOTAL submitted, the second is DRAFTS, and a card that shows the same
// number three times looks entirely plausible.

import { describe, expect, it } from 'vitest'

import {
  filterForms,
  formCardRows,
  formTabCounts,
  sortForms,
} from '@/features/forms/builder/list-view'
import type { Form } from '@/types/forms'

const NOW = new Date('2026-08-08T12:00:00.000Z')

function form(overrides: Partial<Form>): Form {
  return {
    id: 'recA',
    eventId: 'recEvt',
    name: 'Session Submission Form #2',
    publicId: 'pub-a',
    kind: 'cfp',
    entityKind: 'abstracts',
    participantsEnabled: true,
    status: 'published',
    fields: [],
    participantFields: [],
    routing: { rules: [] },
    roles: [],
    crossFieldLimits: [],
    allowMultipleDrafts: false,
    autoRedirectToPortal: true,
    confirmationEmailEnabled: true,
    adminAlertOnNew: [],
    adminAlertOnUpdate: [],
    ...overrides,
  }
}

const SUBMISSIONS = [
  { formId: 'recA', status: 'pending' as const },
  { formId: 'recA', status: 'pending' as const },
  { formId: 'recA', status: 'accepted' as const },
  { formId: 'recA', status: 'draft' as const },
  { formId: 'recB', status: 'pending' as const },
]

function rows(forms: readonly Form[]) {
  return formCardRows({ forms, submissions: SUBMISSIONS, now: NOW, timeZone: 'UTC' })
}

describe('formCardRows', () => {
  it('counts pending, submitted and drafts as three different numbers', () => {
    const row = rows([form({})]).at(0)

    expect(row?.pending).toBe(2)
    // Drafts are not submissions, which is the distinction the card's stat line draws.
    expect(row?.submissions).toBe(3)
    expect(row?.drafts).toBe(1)
  })

  it('counts only its own form, not the whole event', () => {
    expect(rows([form({ id: 'recB', name: 'Other' })]).at(0)?.submissions).toBe(1)
  })

  it('renders a closes line in the event timezone and nothing without a close date', () => {
    const closing = rows([form({ closeDate: '2026-09-15T17:00:00.000Z' })]).at(0)

    expect(closing?.closesLine).toBe('Closes Sep 15, 2026')
    expect(rows([form({})]).at(0)?.closesLine).toBeUndefined()
  })

  it('reports draft, open and closed as three distinct states', () => {
    const states = rows([
      form({ id: '1', status: 'draft' }),
      form({ id: '2', status: 'published' }),
      form({ id: '3', status: 'published', closeDate: '2026-01-01T00:00:00.000Z' }),
    ]).map((row) => row.state)

    expect(states).toEqual(['draft', 'open', 'closed'])
  })
})

describe('formTabCounts', () => {
  it('leaves a draft form out of both Open and Closed', () => {
    const counts = formTabCounts(
      rows([
        form({ id: '1', status: 'draft' }),
        form({ id: '2', status: 'published' }),
        form({ id: '3', status: 'published', closeDate: '2026-01-01T00:00:00.000Z' }),
      ]),
    )

    expect([...counts]).toEqual([
      ['all', 3],
      ['open', 1],
      ['closed', 1],
    ])
  })
})

describe('filterForms', () => {
  it('matches a name case-insensitively on a substring', () => {
    const all = rows([form({ id: '1', name: 'Session Form' }), form({ id: '2', name: 'Sponsors' })])

    expect(filterForms(all, { search: 'session', tab: 'all' })).toHaveLength(1)
  })

  it('applies the tab and the search together', () => {
    const all = rows([
      form({ id: '1', name: 'Session Form', status: 'draft' }),
      form({ id: '2', name: 'Session Form 2', status: 'published' }),
    ])

    expect(filterForms(all, { search: 'session', tab: 'open' }).map((row) => row.id)).toEqual(['2'])
  })
})

describe('sortForms', () => {
  it('opens on Most Pending, with name as the tie-break', () => {
    const all = rows([
      form({ id: 'recB', name: 'Alpha' }),
      form({ id: 'recA', name: 'Zulu' }),
      form({ id: 'recC', name: 'Beta' }),
    ])

    expect(sortForms(all, 'pending').map((row) => row.name)).toEqual(['Zulu', 'Alpha', 'Beta'])
  })

  it('sorts by name when asked', () => {
    const all = rows([form({ id: 'recA', name: 'Zulu' }), form({ id: 'recB', name: 'Alpha' })])

    expect(sortForms(all, 'name').map((row) => row.name)).toEqual(['Alpha', 'Zulu'])
  })
})
