// The profile form's mapping to a write, the Biography cap, and the session-type subtitle.

import { describe, expect, it } from 'vitest'

import { BIO_MAX_LENGTH, profileDraftFrom } from '@/features/portal/profile-form'
import { formatOptions, sessionTypeLabel } from '@/features/portal/session-type'
import { syncErrorIdOf } from './helpers/auth-fakes'
import { field, form } from './helpers/portal-fakes'

function posted(entries: Record<string, string>): ReadonlyMap<string, string> {
  return new Map(Object.entries(entries))
}

describe('profileDraftFrom', () => {
  // Pronouns and Gender post the STORED value, not the label. `woman` and not
  // `Woman`: Airtable single-select choices are case sensitive, and a value it has
  // never heard of comes back as a 422 that rejects the whole speaker record, taking
  // the bio, the headshot and every link down with it.
  it('maps the General and My Links fields onto a speaker draft', () => {
    const draft = profileDraftFrom(
      posted({
        bio: '<p>Builds evals.</p>',
        salutation: 'Dr',
        firstName: 'Ada',
        lastName: 'Okafor',
        honorific: 'PhD',
        pronouns: 'she/her',
        gender: 'woman',
        linkedin: 'https://linkedin.com/in/ada',
        x: 'https://x.com/ada',
        facebook: '',
        website: 'https://ada.example',
      }),
      'owner@example.com',
    )

    expect(draft).toEqual({
      email: 'owner@example.com',
      bio: '<p>Builds evals.</p>',
      salutation: 'Dr',
      firstName: 'Ada',
      lastName: 'Okafor',
      honorific: 'PhD',
      pronouns: 'she/her',
      gender: 'woman',
      links: {
        linkedin: 'https://linkedin.com/in/ada',
        x: 'https://x.com/ada',
        facebook: '',
        website: 'https://ada.example',
      },
    })
  })

  it('never takes the email from the form', () => {
    // The email is the identity magic-link login keys on. Accepting a posted one would let a
    // speaker rewrite their own account.
    const draft = profileDraftFrom(posted({ email: 'attacker@example.com' }), 'owner@example.com')

    expect(draft.email).toBe('owner@example.com')
  })

  it('keeps a cleared field as an empty string rather than dropping it', () => {
    // `speakerFields` drops undefined, so an omitted field would leave the old value in
    // Airtable forever and clearing a pronoun would silently do nothing.
    expect(profileDraftFrom(posted({ pronouns: '   ' }), 'a@b.co').pronouns).toBe('')
  })

  it('rejects a select value Airtable has never heard of', () => {
    // Cheaper here than at the API: an undeclared single-select choice is a 422 on the
    // WHOLE record, so one bad dropdown loses the bio and the headshot posted with it.
    expect(syncErrorIdOf(() => profileDraftFrom(posted({ gender: 'Woman' }), 'a@b.co'))).toBe(
      'E_SUB_003',
    )
    expect(
      syncErrorIdOf(() => profileDraftFrom(posted({ pronouns: 'Prefer not to say' }), 'a@b.co')),
    ).toBe('E_SUB_003')
  })

  it('enforces the 5,000 character cap the counter promises', () => {
    // The counter is a client component and the action is an open POST, so the cap has to
    // exist on the server too.
    const tooLong = posted({ bio: 'x'.repeat(BIO_MAX_LENGTH + 1) })

    expect(syncErrorIdOf(() => profileDraftFrom(tooLong, 'a@b.co'))).toBe('E_SUB_003')
    expect(
      profileDraftFrom(posted({ bio: 'x'.repeat(BIO_MAX_LENGTH) }), 'a@b.co').bio,
    ).toHaveLength(BIO_MAX_LENGTH)
  })
})

describe('sessionTypeLabel', () => {
  const cfp = form({
    fields: [
      field({
        id: 'fld_format',
        label: 'Format',
        type: 'select',
        registryKey: 'format',
        options: [
          { value: 'talk', label: 'Talk (30 min)' },
          { value: 'workshop', label: 'Workshop (90 min)' },
        ],
      }),
    ],
  })

  it('prefers the organizer own option label over a prettified value', () => {
    expect(sessionTypeLabel({ format: 'workshop' }, formatOptions(cfp))).toBe('Workshop (90 min)')
  })

  it('prettifies a value with no option behind it', () => {
    expect(sessionTypeLabel({ format: 'featured_keynote' })).toBe('Featured Keynote')
  })

  it('answers nothing when no format is set, so the card omits the subtitle', () => {
    expect(sessionTypeLabel({ format: undefined })).toBeUndefined()
    expect(sessionTypeLabel({ format: '  ' })).toBeUndefined()
  })

  it('finds no options on a form that does not ask for a format', () => {
    expect(formatOptions(form())).toEqual([])
    expect(formatOptions(undefined)).toEqual([])
  })
})
