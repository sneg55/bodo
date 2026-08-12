// The Add File Request drawer's gate, and what it hands the action.

import { describe, expect, it } from 'vitest'

import {
  assignSummary,
  dueDateKey,
  dueDateValue,
  EMPTY_REQUEST_DRAFT,
  isRequestDraftValid,
  REQUEST_TITLE_MAX,
  REQUEST_TYPE_CARDS,
  toCreateRequestInput,
} from '@/features/file-requests/request-draft'

describe('isRequestDraftValid', () => {
  it('refuses the empty drawer, which is the state ref 31 captured', () => {
    expect(isRequestDraftValid(EMPTY_REQUEST_DRAFT)).toBe(false)
  })

  it('refuses a title of nothing but spaces', () => {
    expect(isRequestDraftValid({ ...EMPTY_REQUEST_DRAFT, title: '   ' })).toBe(false)
  })

  it('accepts a titled request with no instructions and no due date', () => {
    expect(isRequestDraftValid({ ...EMPTY_REQUEST_DRAFT, title: 'Slides' })).toBe(true)
  })

  it('refuses a title past the column cap', () => {
    const long = 'x'.repeat(REQUEST_TITLE_MAX + 1)
    expect(isRequestDraftValid({ ...EMPTY_REQUEST_DRAFT, title: long })).toBe(false)
  })
})

describe('REQUEST_TYPE_CARDS', () => {
  it('offers only the two types that can be built, and not Groups', () => {
    // `Groups` was a permanently disabled tile until 2026-08-10, because ref 31 dims it.
    // There is no Groups table in BUILD_SPEC 3, so it was switched off pending nothing.
    expect(REQUEST_TYPE_CARDS.map((card) => card.label)).toEqual(['Contacts', 'Submissions'])
    expect(REQUEST_TYPE_CARDS.map((card) => card.entityType)).not.toContain('group')
  })

  it('preselects Contacts, as ref 31 does', () => {
    expect(EMPTY_REQUEST_DRAFT.entityType).toBe('contact')
  })
})

describe('toCreateRequestInput', () => {
  it('trims the title and drops empty optional fields', () => {
    expect(
      toCreateRequestInput('recEvent1', { ...EMPTY_REQUEST_DRAFT, title: '  Slides  ' }),
    ).toEqual({
      eventId: 'recEvent1',
      title: 'Slides',
      entityType: 'contact',
      instructionsHtml: undefined,
      required: true,
      dueAt: undefined,
      assign: true,
    })
  })

  it('carries the request switch through, so saving fans the request out', () => {
    // The defect it closes: creating a request assigned it to nobody, said nothing about
    // that, and the card then read "Not requested from anybody yet" while no portal showed
    // it at all.
    expect(
      toCreateRequestInput('recEvent1', { ...EMPTY_REQUEST_DRAFT, title: 'Slides' }).assign,
    ).toBe(true)
    expect(
      toCreateRequestInput('recEvent1', {
        ...EMPTY_REQUEST_DRAFT,
        title: 'Slides',
        requestFromAccepted: false,
      }).assign,
    ).toBe(false)
  })

  it('treats an untouched rich text editor as no instructions', () => {
    const input = toCreateRequestInput('recEvent1', {
      ...EMPTY_REQUEST_DRAFT,
      title: 'Slides',
      instructionsHtml: '<p></p>',
    })

    expect(input.instructionsHtml).toBeUndefined()
  })

  it('keeps the markup when the editor has content', () => {
    const input = toCreateRequestInput('recEvent1', {
      ...EMPTY_REQUEST_DRAFT,
      title: 'Slides',
      instructionsHtml: '<p>Upload a <strong>PDF</strong></p>',
    })

    expect(input.instructionsHtml).toBe('<p>Upload a <strong>PDF</strong></p>')
  })

  it('carries the required flag and the due date through as typed', () => {
    const input = toCreateRequestInput('recEvent1', {
      ...EMPTY_REQUEST_DRAFT,
      title: 'Slides',
      required: false,
      dueAt: '2026-10-01T17:00',
    })

    expect(input.required).toBe(false)
    expect(input.dueAt).toBe('2026-10-01T17:00')
  })
})

describe('dueDateKey and dueDateValue', () => {
  it('round trips a date the picker hands back', () => {
    // Local fields, not `toISOString`: an organizer west of UTC picking the 14th would
    // otherwise store an instant that is still the 13th in UTC and lose a day.
    const picked = new Date(2027, 4, 14, 0, 0, 0)
    expect(dueDateKey(picked)).toBe('2027-05-14')

    const shown = dueDateValue('2027-05-14')
    expect(shown?.getFullYear()).toBe(2027)
    expect(shown?.getMonth()).toBe(4)
    expect(shown?.getDate()).toBe(14)
  })

  it('pads single-digit months and days', () => {
    expect(dueDateKey(new Date(2026, 0, 3, 12))).toBe('2026-01-03')
  })

  it('shows nothing selected when there is no deadline', () => {
    expect(dueDateValue('')).toBeUndefined()
    expect(dueDateValue('next friday')).toBeUndefined()
  })
})

describe('assignSummary', () => {
  it('says plainly when a request was created without reaching anybody', () => {
    expect(assignSummary(undefined)).toBe('Created without requesting it from anybody yet.')
    expect(assignSummary({ created: 0, speakers: 0 })).toBe(
      'No speakers are accepted yet, so nobody has been asked for it.',
    )
  })

  it('counts the rows written and the people they went to', () => {
    expect(assignSummary({ created: 4, speakers: 4 })).toBe('Requested 4 files from 4 speakers.')
    expect(assignSummary({ created: 1, speakers: 1 })).toBe('Requested 1 file from 1 speaker.')
  })

  it('does not claim a fan-out when every row already existed', () => {
    expect(assignSummary({ created: 0, speakers: 3 })).toBe(
      'Everybody accepted already had a row for it.',
    )
  })
})
