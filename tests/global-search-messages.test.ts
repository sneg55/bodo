// What the ⌘K palette says when it has nothing to show yet.
//
// These two functions were one function rendered in one place, inside `CommandEmpty`, and
// that was a bug found on the deployed Worker rather than here: cmdk renders `Command.Empty`
// only when its filtered count is zero, and the `Go to` group matches something for almost
// any query, so `Searching...` and the failure text were both unreachable. A cold search
// showed nav rows and no sign that anything was happening; a failed action looked exactly
// like a search that found nothing.
//
// Splitting them is what makes the fix possible: a status renders unconditionally, an empty
// message renders only when the list really is empty. So what is pinned below is the split
// itself, and above all that the two cannot both speak at once.

import { describe, expect, it } from 'vitest'
import {
  MIN_QUERY_LENGTH,
  searchEmptyMessage,
  searchStatusMessage,
} from '@/features/search/global-search'

describe('searchStatusMessage', () => {
  it('says nothing when a search is neither running nor failed', () => {
    // The common case, and it has to be `undefined` rather than an empty string: the
    // caller decides between a status and `CommandEmpty` on exactly this value.
    expect(searchStatusMessage({ pending: false })).toBeUndefined()
  })

  it('announces a search that is in flight', () => {
    expect(searchStatusMessage({ pending: true })).toBe('Searching...')
  })

  it('surfaces the failure verbatim rather than a generic apology', () => {
    // The action already returns a message written for a person. Replacing it here with
    // "Something went wrong" would throw away the only specific thing on offer.
    expect(searchStatusMessage({ pending: false, failure: 'You cannot search this event.' })).toBe(
      'You cannot search this event.',
    )
  })

  it('prefers the failure over the pending state', () => {
    // Both can be set for an instant while a later keystroke re-fires after an error.
    // Reporting progress over a failure would hide the failure for as long as typing lasts.
    expect(searchStatusMessage({ pending: true, failure: 'Search is unavailable.' })).toBe(
      'Search is unavailable.',
    )
  })
})

describe('searchEmptyMessage', () => {
  it('asks for more characters below the minimum, rather than claiming nothing matched', () => {
    expect(searchEmptyMessage('k')).toBe(
      `Keep typing to search submissions and speakers (${MIN_QUERY_LENGTH} characters).`,
    )
  })

  it('treats whitespace as an empty query, which is what a cleared input sends', () => {
    expect(searchEmptyMessage('   ')).toContain('Keep typing')
  })

  it('reports no results only once the query was long enough to have been searched for', () => {
    // The one sentence in the palette that has to be earned: it is what the broken
    // control answered to every query, on every admin page, for its whole life.
    expect(searchEmptyMessage('kubernetes')).toBe('No results found.')
  })

  it('never returns the pending or failure text, which belong to the status', () => {
    const messages = ['', 'a', 'ab', 'a longer query'].map(searchEmptyMessage)

    expect(messages.some((message) => message.includes('Searching'))).toBe(false)
  })
})
