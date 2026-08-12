// Library > Tags: the rules over a track, tag or room name.
//
// The duplicate check is the one worth pinning. `Submissions.track` is a LINK, so two
// tracks called "AI Engineering" are two different categories that read identically in
// every picker, and a routing rule points at one of them by record id: the organizer would
// have no way to tell which. Same for a room, where the agenda would show two columns with
// one name.

import { describe, expect, it } from 'vitest'

import {
  checkLookupName,
  LOOKUP_NAME_MAX_LENGTH,
  lookupLabel,
  nextLookupOrder,
} from '@/features/settings/lookups'

const EXISTING = [
  { id: 'recA', name: 'AI Engineering' },
  { id: 'recB', name: 'Infrastructure' },
]

describe('checkLookupName', () => {
  it('accepts a new name', () => {
    expect(checkLookupName('track', 'Agents', EXISTING)).toBe(undefined)
  })

  it('requires a name and names the kind in the message', () => {
    expect(checkLookupName('track', '  ', EXISTING)?.message).toBe('Track name is required.')
    expect(checkLookupName('tag', '', EXISTING)?.message).toBe('Tag name is required.')
    expect(checkLookupName('room', '', EXISTING)?.message).toBe('Room name is required.')
  })

  it('refuses a duplicate, ignoring case and surrounding space', () => {
    expect(checkLookupName('track', 'ai engineering', EXISTING)?.message).toBe(
      'Track "ai engineering" already exists on this event.',
    )
    expect(checkLookupName('track', '  Infrastructure  ', EXISTING)).toBeDefined()
  })

  it('allows a rename that keeps the same name, because a row is not its own duplicate', () => {
    expect(checkLookupName('track', 'AI Engineering', EXISTING, 'recA')).toBe(undefined)
  })

  it('still refuses a rename onto another row', () => {
    expect(checkLookupName('track', 'Infrastructure', EXISTING, 'recA')).toBeDefined()
  })

  it('caps the length', () => {
    expect(checkLookupName('tag', 'x'.repeat(LOOKUP_NAME_MAX_LENGTH), EXISTING)).toBe(undefined)
    expect(checkLookupName('tag', 'x'.repeat(LOOKUP_NAME_MAX_LENGTH + 1), EXISTING)).toBeDefined()
  })
})

describe('nextLookupOrder', () => {
  it('appends past the highest order in use', () => {
    expect(nextLookupOrder([1, 2, 5])).toBe(6)
  })

  it('starts at one on an empty event', () => {
    expect(nextLookupOrder([])).toBe(1)
  })

  it('is unaffected by order of the input, so a list read out of sequence still appends', () => {
    expect(nextLookupOrder([5, 1, 3])).toBe(6)
  })
})

describe('lookupLabel', () => {
  it('gives the tab strip its plural and the messages their singular', () => {
    expect(lookupLabel('track')).toEqual({ plural: 'Tracks', singular: 'Track' })
    expect(lookupLabel('tag')).toEqual({ plural: 'Tags', singular: 'Tag' })
    expect(lookupLabel('room')).toEqual({ plural: 'Rooms', singular: 'Room' })
  })
})
