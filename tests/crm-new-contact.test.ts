// The rule behind `Add Contact`: what a hand-typed CRM contact has to be before it is written.
//
// Asserted here rather than through the dialog for the reason the whole repo splits rules out
// of components: the same function decides whether Save is enabled AND what the Server Action
// accepts, so a hole in it is either a control that cannot be pressed or a write nobody
// checked. There is no DOM test environment in this repo, so a rule that only existed inside
// the component could not be asserted at all.

import { describe, expect, it } from 'vitest'
import {
  CONTACT_EMAIL_MAX,
  CONTACT_VALUE_MAX,
  checkNewContact,
  contactDisplayName,
  EMPTY_CONTACT_DRAFT,
  type NewContactDraft,
} from '@/features/crm/new-contact'

const draft = (patch: Partial<NewContactDraft> = {}): NewContactDraft => ({
  ...EMPTY_CONTACT_DRAFT,
  email: 'ada@example.com',
  eventId: 'evt1',
  ...patch,
})

describe('checkNewContact', () => {
  it('accepts an address and an event, since nothing else is required', () => {
    expect(checkNewContact(draft())).toEqual({
      ok: true,
      contact: { email: 'ada@example.com', eventId: 'evt1' },
    })
  })

  it('refuses a missing address with the words the import uses', () => {
    // The same two reasons `mapRow` and `planRow` give, so one organizer meets one vocabulary
    // whichever way they are adding people.
    expect(checkNewContact(draft({ email: '   ' }))).toEqual({
      ok: false,
      reason: 'Missing email',
    })
  })

  it('refuses an address with no @', () => {
    expect(checkNewContact(draft({ email: 'nope' }))).toEqual({
      ok: false,
      reason: 'Invalid email',
    })
  })

  it('refuses an address longer than the RFC allows', () => {
    const long = `${'a'.repeat(CONTACT_EMAIL_MAX)}@example.com`
    expect(checkNewContact(draft({ email: long })).ok).toBe(false)
  })

  it('refuses a draft with no event chosen', () => {
    expect(checkNewContact(draft({ eventId: '' }))).toEqual({
      ok: false,
      reason: 'Pick the event to add them to.',
    })
  })

  it('trims every field and keeps the address as typed', () => {
    // Not lowercased: `upsertSpeakerByEmail` normalizes before matching and before writing,
    // and echoing what the organizer typed is what makes the toast recognisable.
    const checked = checkNewContact(
      draft({ email: '  Ada@Example.COM ', firstName: ' Ada ', company: ' Analytical  ' }),
    )
    expect(checked.ok && checked.contact).toEqual({
      email: 'Ada@Example.COM',
      eventId: 'evt1',
      firstName: 'Ada',
      company: 'Analytical',
    })
  })

  it('drops an empty optional field rather than carrying a blank', () => {
    // A blank would be written as an empty cell by `speakerFields`, which is not what leaving
    // a field alone means.
    const checked = checkNewContact(draft({ firstName: '   ', lastName: '' }))
    expect(checked.ok && Object.hasOwn(checked.contact, 'firstName')).toBe(false)
    expect(checked.ok && Object.hasOwn(checked.contact, 'lastName')).toBe(false)
  })

  it('refuses a field longer than the payload bound', () => {
    expect(checkNewContact(draft({ company: 'x'.repeat(CONTACT_VALUE_MAX + 1) })).ok).toBe(false)
    expect(checkNewContact(draft({ company: 'x'.repeat(CONTACT_VALUE_MAX) })).ok).toBe(true)
  })

  it('refuses the empty draft, so an untouched dialog cannot be submitted', () => {
    expect(checkNewContact(EMPTY_CONTACT_DRAFT).ok).toBe(false)
  })
})

describe('contactDisplayName', () => {
  it('joins the halves that are present', () => {
    expect(contactDisplayName({ email: 'a@b.co', eventId: 'e', firstName: 'Ada' })).toBe('Ada')
    expect(
      contactDisplayName({ email: 'a@b.co', eventId: 'e', firstName: 'Ada', lastName: 'Lovelace' }),
    ).toBe('Ada Lovelace')
  })

  it('falls back to the address, the way a directory row does', () => {
    expect(contactDisplayName({ email: 'a@b.co', eventId: 'e' })).toBe('a@b.co')
  })
})
