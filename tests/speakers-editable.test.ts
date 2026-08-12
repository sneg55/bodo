// The two adaptations into `EditableSpeaker`, and the merge back out.
//
// Worth testing because one of the two adapters is lossy and the other is not, and the whole
// reason the shared shape exists is to keep the lossy one off the surface that does not need
// it. A regression here is silent: the sheet opens, the fields are populated, and a compound
// surname is quietly rewritten on save.

import { describe, expect, it } from 'vitest'

import type { RosterSpeaker } from '@/features/speakers/admin-roster'
import {
  editableFromRoster,
  editableFromSpeaker,
  mergeIntoRoster,
  omitEmpty,
} from '@/features/speakers/editable-speaker'
import type { Speaker } from '@/types/domain'

const speaker = (fields: Partial<Speaker> = {}): Speaker => ({
  id: 'spk1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Okafor',
  links: {},
  ...fields,
})

const roster = (fields: Partial<RosterSpeaker> = {}): RosterSpeaker => ({
  id: 'spk1',
  name: 'Ada Okafor',
  email: 'ada@example.com',
  initials: 'AO',
  status: 'prospect',
  submissionCount: 0,
  hasAccepted: false,
  ...fields,
})

describe('editableFromSpeaker', () => {
  it('takes the two stored name columns rather than a joined string', () => {
    const editable = editableFromSpeaker(speaker({ firstName: 'Ada', lastName: 'van der Berg' }))
    expect(editable).toMatchObject({ firstName: 'Ada', lastName: 'van der Berg' })
  })

  it('does not lose a compound surname the roster adapter would split wrongly', () => {
    // The point of the whole shape. Same person through the two adapters, and only the one
    // with the columns in hand gets it right; see the roster case below for the contrast.
    const person = speaker({ firstName: 'Ada', lastName: 'van der Berg' })
    expect(editableFromSpeaker(person).lastName).toBe('van der Berg')
  })

  it('reads an absent status as prospect, matching every surface that groups on it', () => {
    expect(editableFromSpeaker(speaker()).status).toBe('prospect')
  })

  it('keeps a status the record does carry', () => {
    expect(editableFromSpeaker(speaker({ status: 'confirmed' })).status).toBe('confirmed')
  })

  it('carries the email so the sheet can show it, and the id so the action can name it', () => {
    expect(editableFromSpeaker(speaker())).toMatchObject({
      id: 'spk1',
      email: 'ada@example.com',
    })
  })
})

describe('editableFromRoster', () => {
  it('splits a display name on the last space', () => {
    expect(editableFromRoster(roster())).toMatchObject({ firstName: 'Ada', lastName: 'Okafor' })
  })

  it('gets a compound surname wrong, which is why the CRM does not go through it', () => {
    // Asserted rather than lamented in a comment: this is the documented limitation of the
    // roster path, and it is what makes `editableFromSpeaker` a correctness fix and not a
    // tidy-up. If a future change makes this pass differently, the header on
    // `editable-speaker.ts` is wrong and needs rewriting rather than this test relaxing.
    const editable = editableFromRoster(roster({ name: 'Ada van der Berg' }))
    expect(editable.firstName).toBe('Ada van der')
    expect(editable.lastName).toBe('Berg')
  })

  it('leaves both names empty when the row is falling back to the email', () => {
    // `loadSpeakerRoster` shows the email when nothing has been filled in. Seeding the
    // inputs with it would make the organizer delete an address out of a name field.
    const editable = editableFromRoster(roster({ name: 'ada@example.com' }))
    expect(editable).toMatchObject({ firstName: '', lastName: '' })
  })

  it('keeps a single-word name as the first name', () => {
    expect(editableFromRoster(roster({ name: 'Prince' }))).toMatchObject({
      firstName: 'Prince',
      lastName: '',
    })
  })
})

describe('mergeIntoRoster', () => {
  const saved = {
    id: 'spk1',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Okafor-Smith',
    company: 'Bodo',
    status: 'confirmed' as const,
  }

  it('rebuilds the display name from the two saved columns', () => {
    expect(mergeIntoRoster(roster(), saved).name).toBe('Ada Okafor-Smith')
  })

  it('falls back to the email when both names are cleared, as a fresh load would', () => {
    const cleared = { ...saved, firstName: '', lastName: '' }
    expect(mergeIntoRoster(roster(), cleared).name).toBe('ada@example.com')
  })

  it('writes an emptied field through as absent rather than keeping the old value', () => {
    // The row must agree with the record: the write cleared it, so the table has to stop
    // showing it, and `{...row, ...saved}` on a partial object was how it used to not.
    const row = roster({ company: 'Old Co', tagline: 'Old tagline', dietary: 'None' })
    const merged = mergeIntoRoster(row, saved)
    expect(merged.tagline).toBeUndefined()
    expect(merged.dietary).toBeUndefined()
    expect(merged.company).toBe('Bodo')
  })

  it('leaves the fields the sheet never edits alone', () => {
    // Invited-at and the submission counts are not the editor's to touch, and losing them
    // would blank two columns of the table on every save.
    const row = roster({ invitedAt: '2026-08-01T10:00:00.000Z', submissionCount: 3 })
    expect(mergeIntoRoster(row, saved)).toMatchObject({
      invitedAt: '2026-08-01T10:00:00.000Z',
      submissionCount: 3,
      initials: 'AO',
    })
  })
})

describe('omitEmpty', () => {
  // What Add Speaker means by a box nobody typed in. `addSpeakerAction` upserts BY EMAIL,
  // so adding a returning speaker is an edit of their row, and `speakerFields` writes `''`
  // as the `null` that clears a column. `undefined` is the only value that leaves what the
  // speaker wrote in their own portal alone. See editable-speaker.ts.
  it('drops an empty field so the upsert never writes it', () => {
    expect(omitEmpty('')).toBeUndefined()
  })

  it('drops a whitespace-only field, which is the same thing typed slower', () => {
    expect(omitEmpty('   \n ')).toBeUndefined()
  })

  it('drops an absent field', () => {
    expect(omitEmpty(undefined)).toBeUndefined()
  })

  it('keeps a filled field, trimmed', () => {
    expect(omitEmpty('  Head of Platform  ')).toBe('Head of Platform')
  })

  it('keeps a biography, which arrives as the HTML the textarea was converted to', () => {
    expect(omitEmpty('<p>Ada builds compilers.</p>')).toBe('<p>Ada builds compilers.</p>')
  })
})
