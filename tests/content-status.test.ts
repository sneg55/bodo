// Where a session's content stands.
//
// A separate axis from acceptance and from scheduling, which is the whole point: an accepted
// talk whose slides nobody has read and one whose slides were sent back for changes were
// identical on every column this schema had, so "what still needs reading" could only be
// answered by opening every deck.

import { describe, expect, it } from 'vitest'

import { CONTENT_STATUSES, type ContentStatus, contentStatusLabel } from '@/constants/status'
import { COL } from '@/services/airtable/tables'
import { contentStatusFields } from '@/services/airtable/to-fields'

describe('CONTENT_STATUSES', () => {
  it('starts at not-submitted, so the column always says something', () => {
    // A session nobody has uploaded anything for is a fact worth stating rather than a
    // blank cell, and it is what every row predating the column reads as.
    expect(CONTENT_STATUSES[0]).toBe('not_submitted')
  })

  it('distinguishes never-looked-at from sent-back, which is the gap being closed', () => {
    expect(CONTENT_STATUSES).toContain('pending_review')
    expect(CONTENT_STATUSES).toContain('changes_requested')
    expect(CONTENT_STATUSES).toContain('approved')
  })

  it('labels every status, so no raw underscore reaches a screen', () => {
    for (const status of CONTENT_STATUSES) {
      const label = contentStatusLabel(status)
      expect(label).not.toContain('_')
      expect(label.length).toBeGreaterThan(0)
    }
  })
})

describe('contentStatusFields', () => {
  it('writes one column and nothing else', () => {
    // Written on its own rather than through the edit writer: that one carries a title and
    // an abstract and records a revision per field, so routing approval through it would
    // put an empty revision in the history every time somebody signed a deck off.
    const fields = contentStatusFields('approved')

    expect(fields).toEqual({ [COL.contentStatus]: 'approved' })
    expect(Object.keys(fields)).toHaveLength(1)
  })

  it('round-trips every status in the vocabulary', () => {
    for (const status of CONTENT_STATUSES) {
      expect(contentStatusFields(status)[COL.contentStatus]).toBe(status)
    }
  })

  it('is typed to the vocabulary, so an invented status cannot be written', () => {
    // A compile-time guarantee, asserted here so the intent survives a refactor: the
    // parameter is ContentStatus, and the action re-checks the string it receives against
    // the same list because a Server Action is reachable by POST.
    const status: ContentStatus = 'changes_requested'
    expect(contentStatusFields(status)[COL.contentStatus]).toBe('changes_requested')
  })
})
