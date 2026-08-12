// A profile save must not blank a field the form never posted.
//
// The Biography editor is a `next/dynamic` chunk with `ssr: false`, and the hidden input
// that carries its value lives inside that chunk. Until it lands, or if it never lands,
// the form has no `bio` entry at all while Save sits there enabled. Reading an absent key
// as `''` therefore turned that window into a silent wipe of a stored biography, which is
// what a walkthrough saw: an empty editor under a `0 / 5,000 characters` counter, on a
// speaker whose record held a bio.

import { describe, expect, it } from 'vitest'

import { profileDraftFrom } from '@/features/portal/profile-form'

function posted(entries: Record<string, string>): ReadonlyMap<string, string> {
  return new Map(Object.entries(entries))
}

const STORED_LINKS = { linkedin: 'https://linkedin.com/in/chen', website: 'https://chen.example' }

describe('profileDraftFrom, fields the form did not post', () => {
  it('omits an unposted biography instead of clearing it', () => {
    // `speakerFields` drops undefined, so an omitted field leaves Airtable's value alone.
    const draft = profileDraftFrom(
      posted({ firstName: 'Chen', lastName: 'Wei' }),
      'chen@example.com',
    )

    expect(draft.bio).toBeUndefined()
    expect(draft.firstName).toBe('Chen')
  })

  it('still clears a biography the speaker emptied on purpose', () => {
    // The distinction the whole change rests on: posted-and-empty is a clear, absent is not.
    expect(profileDraftFrom(posted({ bio: '   ' }), 'chen@example.com').bio).toBe('')
  })

  it('leaves the links column alone when none of the four posted', () => {
    // They share one JSON column, so an empty object would clear all four at once.
    expect(
      profileDraftFrom(posted({ bio: '<p>hi</p>' }), 'chen@example.com', STORED_LINKS).links,
    ).toBeUndefined()
  })

  it('fills an unposted link from the record and keeps a cleared one cleared', () => {
    const draft = profileDraftFrom(
      posted({ x: 'https://x.com/chen', website: '' }),
      'chen@example.com',
      STORED_LINKS,
    )

    expect(draft.links).toEqual({
      linkedin: 'https://linkedin.com/in/chen',
      x: 'https://x.com/chen',
      facebook: undefined,
      website: '',
    })
  })

  it('does not validate a select that never posted', () => {
    // Nothing to reject and nothing to write: the control was not on the page.
    const draft = profileDraftFrom(posted({ firstName: 'Chen' }), 'chen@example.com')

    expect(draft.pronouns).toBeUndefined()
    expect(draft.gender).toBeUndefined()
  })
})
