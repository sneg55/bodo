// The Field Options section, as rules.
//
// Reference: docs/parity/external-references.md, "Embed Filters and Field Options", verbatim:
// "Choose fields for the Agenda, Speaker, and Session cards. Grey fields are required; blue fields
// are preselected and customizable." That settles three things and leaves one open.
//
// Settled: three card types rather than one flat list; a required tier that cannot be deselected;
// a preselected tier that can. Open: the individual field names, which no public source
// enumerates. They are derived from what the embed views already render, cross-checked against the
// 37-field Session and 30-field SessionSpeaker objects in Sessionboard's developer docs, and
// filtered to what our Airtable schema actually holds. src/features/cms/field-options.ts records
// the derivation per field and records what was excluded on purpose.
//
// The property worth pinning hardest: a required field cannot be turned off THROUGH THE MODEL, not
// merely through the UI. Selection is stored as a JSON blob in an Airtable cell an organizer can
// edit by hand, so "the checkbox is disabled" is not the guarantee. `visibleEmbedFields` unions
// the required tier in every time.

import { describe, expect, it } from 'vitest'

import {
  cardTypeForView,
  defaultEmbedFieldOptions,
  EMBED_CARD_FIELDS,
  embedCardFields,
  normalizeEmbedFieldOptions,
  toggleEmbedField,
  visibleEmbedFields,
} from '@/features/cms/field-options'
import { EMBED_CARD_TYPES, EMBED_VIEWS } from '@/types/cms'

describe('the card inventory', () => {
  it('covers the three card types the reference names', () => {
    expect([...EMBED_CARD_FIELDS.keys()]).toEqual(['agenda', 'speaker', 'session'])
  })

  it('gives every card at least one required and one optional field', () => {
    for (const card of EMBED_CARD_TYPES) {
      const fields = embedCardFields(card)

      expect(fields.some((field) => field.required)).toBe(true)
      expect(fields.some((field) => !field.required)).toBe(true)
    }
  })

  it('never offers a private contact detail as a selectable field', () => {
    // The reference's SessionSpeaker object carries email, phone and postal address. This is a
    // PUBLIC embed on somebody else's website, so none of them may be selectable regardless.
    const keys = EMBED_CARD_TYPES.flatMap((card) => embedCardFields(card).map((f) => f.key))

    for (const banned of ['email', 'phone', 'address', 'adminUrl']) {
      expect(keys).not.toContain(banned)
    }
  })
})

describe('cardTypeForView', () => {
  it('maps the two day-grouped views to the Agenda card', () => {
    expect(cardTypeForView('agenda')).toBe('agenda')
    expect(cardTypeForView('schedule_itinerary')).toBe('agenda')
  })

  it('maps the flat list to the Session card and both rosters to the Speaker card', () => {
    expect(cardTypeForView('session_list')).toBe('session')
    expect(cardTypeForView('speaker_list')).toBe('speaker')
    expect(cardTypeForView('speaker_gallery')).toBe('speaker')
  })

  it('resolves every view, so no layout renders with an unknown card', () => {
    for (const view of EMBED_VIEWS) {
      expect(EMBED_CARD_TYPES).toContain(cardTypeForView(view))
    }
  })
})

describe('defaults', () => {
  it('preselects every optional field, per "blue fields are preselected"', () => {
    const defaults = defaultEmbedFieldOptions()

    for (const card of EMBED_CARD_TYPES) {
      const optional = embedCardFields(card)
        .filter((field) => !field.required)
        .map((field) => field.key)

      expect([...visibleEmbedFields(defaults, card)].toSorted()).toEqual(
        [...optional, ...requiredKeys(card)].toSorted(),
      )
    }
  })
})

describe('visibleEmbedFields', () => {
  it('keeps a required field visible even when the stored blob omits it', () => {
    const hostile = normalizeEmbedFieldOptions({ agenda: [], speaker: [], session: [] })

    for (const card of EMBED_CARD_TYPES) {
      for (const key of requiredKeys(card)) {
        expect(visibleEmbedFields(hostile, card)).toContain(key)
      }
    }
  })

  it('drops an optional field the organizer deselected', () => {
    const off = toggleEmbedField(defaultEmbedFieldOptions(), 'agenda', 'speakers', false)

    expect(visibleEmbedFields(off, 'agenda')).not.toContain('speakers')
    expect(visibleEmbedFields(off, 'agenda')).toContain('title')
  })

  it('ignores a field name the blob invented', () => {
    const options = normalizeEmbedFieldOptions({ agenda: ['speakers', 'email'] })

    expect(visibleEmbedFields(options, 'agenda')).not.toContain('email')
    expect(visibleEmbedFields(options, 'agenda')).toContain('speakers')
  })

  it('does not leak one card selection into another', () => {
    const off = toggleEmbedField(defaultEmbedFieldOptions(), 'session', 'room', false)

    expect(visibleEmbedFields(off, 'session')).not.toContain('room')
    expect(visibleEmbedFields(off, 'agenda')).toContain('room')
  })
})

describe('toggleEmbedField', () => {
  it('refuses to deselect a required field', () => {
    for (const card of EMBED_CARD_TYPES) {
      for (const key of requiredKeys(card)) {
        const attempt = toggleEmbedField(defaultEmbedFieldOptions(), card, key, false)

        expect(visibleEmbedFields(attempt, card)).toContain(key)
      }
    }
  })

  it('is idempotent in both directions', () => {
    const once = toggleEmbedField(defaultEmbedFieldOptions(), 'speaker', 'company', false)
    const twice = toggleEmbedField(once, 'speaker', 'company', false)

    expect(visibleEmbedFields(twice, 'speaker')).toEqual(visibleEmbedFields(once, 'speaker'))

    const back = toggleEmbedField(twice, 'speaker', 'company', true)
    expect(visibleEmbedFields(back, 'speaker')).toContain('company')
  })
})

describe('normalizeEmbedFieldOptions', () => {
  it('reads a missing or malformed blob as the defaults', () => {
    // The safe direction for a public feed: an unparseable cell must not blank every card.
    for (const raw of [undefined, null, 'nonsense', 42, [], { agenda: 'speakers' }]) {
      expect(normalizeEmbedFieldOptions(raw)).toEqual(defaultEmbedFieldOptions())
    }
  })

  it('reads an explicitly empty card as every optional field off', () => {
    const options = normalizeEmbedFieldOptions({ agenda: [], speaker: [], session: [] })

    expect(visibleEmbedFields(options, 'agenda')).toEqual(new Set(requiredKeys('agenda')))
  })
})

function requiredKeys(card: 'agenda' | 'speaker' | 'session'): readonly string[] {
  return embedCardFields(card)
    .filter((field) => field.required)
    .map((field) => field.key)
}
