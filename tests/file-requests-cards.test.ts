// The admin File Requests list: its cards, its tab counts, and the join that feeds them.

import { describe, expect, it } from 'vitest'

import { filterRequestCards, requestTabs, toRequestCards } from '@/features/file-requests/cards'
import { fileRequestItems } from '@/services/airtable/reads-requests'

import {
  CO_SPEAKER,
  fileRequest,
  OWNER,
  requestAssignment,
  requestItem,
} from './helpers/portal-fakes'

const TZ = 'America/Los_Angeles'

const release = fileRequest({
  id: 'recReqRelease',
  entityType: 'contact',
  title: 'Signed speaker release',
  required: true,
  instructionsHtml: '<p>Sign it and <strong>upload the PDF</strong>.</p>',
})
const slides = fileRequest({
  id: 'recReqSlides',
  entityType: 'submission',
  title: 'Presentation slides',
  required: false,
  dueAt: '2026-10-01T00:00:00.000Z',
})

describe('toRequestCards', () => {
  it('renders the type label as Session for a submission request', () => {
    const cards = toRequestCards({ requests: [slides], items: [], timeZone: TZ })

    expect(cards[0]?.typeLabel).toBe('Session')
    expect(cards[0]?.dueLabel).toBe('Due Sep 30, 2026')
  })

  it('flattens the instructions HTML to a snippet', () => {
    const cards = toRequestCards({ requests: [release], items: [], timeZone: TZ })

    expect(cards[0]?.instructions).toBe('Sign it and upload the PDF.')
  })

  it('reports a request nobody is assigned as zero of zero', () => {
    const cards = toRequestCards({ requests: [release], items: [], timeZone: TZ })

    expect(cards[0]?.assigned).toBe(0)
    expect(cards[0]?.received).toBe(0)
  })

  it('counts distinct assignments and the delivered ones', () => {
    const items = [
      requestItem({ request: release, assignment: { id: 'recA1', speakerId: OWNER } }),
      requestItem({
        request: release,
        assignment: { id: 'recA2', speakerId: CO_SPEAKER, status: 'received' },
      }),
    ]
    const cards = toRequestCards({ requests: [release], items, timeZone: TZ })

    expect(cards[0]?.assigned).toBe(2)
    expect(cards[0]?.received).toBe(1)
  })

  it('counts a duplicate row once, so the card agrees with the delivery table', () => {
    const items = [
      requestItem({ request: release, assignment: { id: 'recA1', speakerId: OWNER } }),
      requestItem({ request: release, assignment: { id: 'recDupe', speakerId: OWNER } }),
    ]
    const cards = toRequestCards({ requests: [release], items, timeZone: TZ })

    expect(cards[0]?.assigned).toBe(1)
  })
})

describe('requestTabs', () => {
  it('carries the four captured labels and their counts', () => {
    const cards = toRequestCards({ requests: [release, slides], items: [], timeZone: TZ })

    expect(requestTabs(cards)).toEqual([
      { id: 'all', label: 'All Requests', count: 2 },
      { id: 'contact', label: 'Contact Requests', count: 1 },
      { id: 'group', label: 'Group Requests', count: 0 },
      { id: 'submission', label: 'Submission Requests', count: 1 },
    ])
  })

  it('reads all zeroes on an event with no requests, which is what ref 30 captured', () => {
    expect(requestTabs([]).map((tab) => tab.count)).toEqual([0, 0, 0, 0])
  })
})

describe('filterRequestCards', () => {
  const cards = toRequestCards({ requests: [release, slides], items: [], timeZone: TZ })

  it('filters by tab', () => {
    expect(filterRequestCards(cards, 'submission', '').map((card) => card.id)).toEqual([
      'recReqSlides',
    ])
  })

  it('searches the title and the instructions snippet together', () => {
    expect(filterRequestCards(cards, 'all', 'PDF').map((card) => card.id)).toEqual([
      'recReqRelease',
    ])
    expect(filterRequestCards(cards, 'all', 'slides').map((card) => card.id)).toEqual([
      'recReqSlides',
    ])
  })

  it('ignores case and surrounding space', () => {
    expect(filterRequestCards(cards, 'all', '  RELEASE ')).toHaveLength(1)
  })
})

describe('fileRequestItems', () => {
  it('drops an assignment whose request belongs to another event', () => {
    const items = fileRequestItems(
      [release],
      [requestAssignment({ id: 'recStray', fileRequestId: 'recReqFromAnotherEvent' })],
      () => true,
    )

    expect(items).toEqual([])
  })

  it('keeps only the rows the predicate accepts', () => {
    const items = fileRequestItems(
      [release],
      [
        requestAssignment({ id: 'recA1', fileRequestId: release.id, speakerId: OWNER }),
        requestAssignment({ id: 'recA2', fileRequestId: release.id, speakerId: CO_SPEAKER }),
      ],
      (assignment) => assignment.speakerId === OWNER,
    )

    expect(items.map((item) => item.assignment.id)).toEqual(['recA1'])
  })

  it('sorts by due date with the undated last, then by title', () => {
    const early = fileRequest({ id: 'recEarly', title: 'B', dueAt: '2026-09-01T00:00:00.000Z' })
    const late = fileRequest({ id: 'recLate', title: 'A', dueAt: '2026-10-01T00:00:00.000Z' })
    const undated = fileRequest({ id: 'recUndated', title: 'A' })

    const items = fileRequestItems(
      [undated, late, early],
      [
        requestAssignment({ id: 'recA1', fileRequestId: 'recUndated' }),
        requestAssignment({ id: 'recA2', fileRequestId: 'recLate' }),
        requestAssignment({ id: 'recA3', fileRequestId: 'recEarly' }),
      ],
      () => true,
    )

    expect(items.map((item) => item.request.id)).toEqual(['recEarly', 'recLate', 'recUndated'])
  })
})
