// What Add Speaker is allowed to write, and what it must leave alone.
//
// This is the arithmetic behind a confirmed data-loss defect, so the tests are written against
// the thing that actually reaches Airtable rather than against the draft alone: the last two
// blocks run the draft through `speakerFields`, because "absent" and "empty" are the same word
// in a form and opposite instructions to the API. `blank('')` is `null`, which CLEARS a
// column; `undefined` is dropped by `compact` and touches nothing. A draft that looks right
// and maps to `{ status: null }` would still be the bug.
//
// The defect: re-adding a speaker who was already on the roster reset her status from
// Confirmed to Prospect and cleared her company, because the sheet's Status select always has
// a value and its Company box was sent as `''`. The roster's CONFIRMED tab went from 4 to 3
// with no warning anywhere.

import { describe, expect, it } from 'vitest'

import {
  assertSpeakerEmail,
  buildAddSpeakerDraft,
  normalizeSpeakerEmail,
} from '@/features/speakers/add-speaker-draft'
import {
  dispositionOf,
  existingEmailSet,
  importCounts,
  importCountsLabel,
} from '@/features/speakers/import-outcome'
import { COL } from '@/services/airtable/tables'
import { speakerFields } from '@/services/airtable/to-fields'

/** The shape the sheet posts when the organizer typed a name and an address and nothing else. */
const untouched = { email: 'ada@example.com', name: 'Ada Okafor' }

describe('buildAddSpeakerDraft, on somebody who already exists', () => {
  it('sends no status, so re-adding a Confirmed speaker cannot demote them', () => {
    expect(buildAddSpeakerDraft(untouched, { exists: true }).status).toBeUndefined()
  })

  it('sends no company, so an untouched box cannot clear the stored one', () => {
    expect(buildAddSpeakerDraft(untouched, { exists: true }).company).toBeUndefined()
    expect(
      buildAddSpeakerDraft({ ...untouched, company: '   ' }, { exists: true }).company,
    ).toBeUndefined()
  })

  it('sends the status when the organizer deliberately picked one', () => {
    expect(
      buildAddSpeakerDraft({ ...untouched, status: 'confirmed' }, { exists: true }).status,
    ).toBe('confirmed')
  })

  it('sends the status even when the pick is the default, because a pick is a pick', () => {
    expect(
      buildAddSpeakerDraft({ ...untouched, status: 'prospect' }, { exists: true }).status,
    ).toBe('prospect')
  })

  it('sends the company when the organizer typed one, trimmed', () => {
    expect(
      buildAddSpeakerDraft({ ...untouched, company: ' Bodo Labs ' }, { exists: true }).company,
    ).toBe('Bodo Labs')
  })

  it('leaves the tagline and the biography alone when both boxes are empty', () => {
    const draft = buildAddSpeakerDraft({ ...untouched, tagline: '', bio: '' }, { exists: true })
    expect(draft.tagline).toBeUndefined()
    expect(draft.bio).toBeUndefined()
  })

  it('leaves both name columns alone when the Name box is blank', () => {
    const draft = buildAddSpeakerDraft({ email: 'ada@example.com', name: '  ' }, { exists: true })
    expect(draft.firstName).toBeUndefined()
    expect(draft.lastName).toBeUndefined()
  })

  it('leaves the surname alone when only one word was typed', () => {
    const draft = buildAddSpeakerDraft({ email: 'ada@example.com', name: 'Ada' }, { exists: true })
    expect(draft.firstName).toBe('Ada')
    expect(draft.lastName).toBeUndefined()
  })
})

describe('buildAddSpeakerDraft, on somebody new', () => {
  it('defaults the status to prospect, because there is no stored value to preserve', () => {
    expect(buildAddSpeakerDraft(untouched, { exists: false }).status).toBe('prospect')
  })

  it('still takes a deliberate status over the default', () => {
    expect(
      buildAddSpeakerDraft({ ...untouched, status: 'confirmed' }, { exists: false }).status,
    ).toBe('confirmed')
  })

  it('splits the typed name into the two stored columns', () => {
    const draft = buildAddSpeakerDraft(untouched, { exists: false })
    expect(draft.firstName).toBe('Ada')
    expect(draft.lastName).toBe('Okafor')
  })
})

describe('buildAddSpeakerDraft refusals', () => {
  it('refuses a value outside the closed status vocabulary rather than coercing it', () => {
    expect(() => buildAddSpeakerDraft({ ...untouched, status: 'vip' }, { exists: true })).toThrow(
      /not a speaker status/u,
    )
  })

  it('refuses a biography past the cap the portal editor enforces', () => {
    expect(() =>
      buildAddSpeakerDraft({ ...untouched, bio: 'x'.repeat(5001) }, { exists: false }),
    ).toThrow(/5000/u)
  })

  it('refuses a string that is not an address', () => {
    expect(() => assertSpeakerEmail('Ada Okafor')).toThrow(/not an email address/u)
  })

  it('normalizes the address it does accept', () => {
    expect(assertSpeakerEmail('  Ada@Example.COM ')).toBe('ada@example.com')
    expect(normalizeSpeakerEmail(' ADA@example.com')).toBe('ada@example.com')
  })
})

describe('what actually reaches Airtable', () => {
  it('names neither status nor company for an untouched re-add', () => {
    const fields = speakerFields(buildAddSpeakerDraft(untouched, { exists: true }))
    expect(Object.hasOwn(fields, COL.status)).toBe(false)
    expect(Object.hasOwn(fields, COL.company)).toBe(false)
    expect(Object.hasOwn(fields, COL.email)).toBe(true)
  })

  it('names both when both were deliberately set', () => {
    const fields = speakerFields(
      buildAddSpeakerDraft(
        { ...untouched, status: 'confirmed', company: 'Bodo Labs' },
        { exists: true },
      ),
    )
    expect(fields[COL.status]).toBe('confirmed')
    expect(fields[COL.company]).toBe('Bodo Labs')
  })

  it('would have cleared the column, which is what the old behaviour sent', () => {
    // The regression this whole file exists to pin: `''` is not absence.
    const fields = speakerFields({ email: 'ada@example.com', company: '', status: 'prospect' })
    expect(fields[COL.company]).toBeNull()
    expect(fields[COL.status]).toBe('prospect')
  })
})

describe('import dispositions', () => {
  const existing = existingEmailSet([' ADA@example.com ', 'bo@example.com'])

  it('normalizes both sides before comparing', () => {
    expect(dispositionOf('Ada@Example.com', existing)).toBe('update')
    expect(dispositionOf('new@example.com', existing)).toBe('create')
  })

  it('counts creates and updates separately', () => {
    expect(
      importCounts(['ada@example.com', 'new@example.com', 'bo@example.com'], existing),
    ).toEqual({ create: 1, update: 2 })
  })

  it('counts a repeated address once, as whatever the first occurrence was', () => {
    expect(importCounts(['new@example.com', 'NEW@example.com'], existing)).toEqual({
      create: 1,
      update: 0,
    })
  })

  it('says it in the CRM wizard the same way the CRM wizard says it', () => {
    expect(importCountsLabel({ create: 0, update: 3 })).toBe('0 to create, 3 to update')
  })
})
