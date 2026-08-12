// Widening a select that already exists. Pass three.
//
// This exists because of a specific incident rather than for symmetry. `CmsEmbeds.format`
// shipped as a single-select holding one choice, `styled_html`. Four more formats were
// added to the declaration. `planSchema` matched the field by name and by type, counted it
// in `matchedFields`, and planned nothing -- so `airtable:schema:plan` printed "0 fields"
// and read as a base in perfect agreement with the declaration, while every save of a new
// format returned 422 INVALID_MULTIPLE_CHOICE_OPTIONS.
//
// The migration script had created that field and could no longer keep it correct, and the
// plan's own output was what hid it. The first test below is that base, exactly.

import { describe, expect, it } from 'vitest'

import { planIsEmpty, planSchema } from '@/migrations/diff'
import { choicePatchFor, type ExistingTable } from '@/migrations/existing-schema'
import { select, type TableSpec, text } from '@/migrations/schema-types'

const DECLARED: readonly TableSpec[] = [
  {
    name: 'CmsEmbeds',
    fields: [text('name'), select('format', ['styled_html', 'basic_html', 'json', 'xml', 'ical'])],
  },
]

/** The base as it actually stood: the field is there, its vocabulary is not. */
const NARROW: readonly ExistingTable[] = [
  {
    id: 'tblEmbeds',
    name: 'CmsEmbeds',
    fields: [
      { id: 'fldName', name: 'name', type: 'singleLineText' },
      {
        id: 'fldFormat',
        name: 'format',
        type: 'singleSelect',
        options: { choices: [{ id: 'selStyled', name: 'styled_html' }] },
      },
    ],
  },
]

describe('a select that exists but is short of its declared choices', () => {
  it('is planned, where it used to be counted as matched and skipped', () => {
    const plan = planSchema(NARROW, DECLARED)

    // The field itself is still correctly a match: same name, same type, nothing to create.
    expect(plan.addFields).toEqual([])
    expect(plan.matchedFields).toBe(2)

    // ...and there is nonetheless work to do, which is the whole point.
    expect(plan.choiceAdds).toHaveLength(1)
    expect(plan.choiceAdds[0]).toMatchObject({
      tableName: 'CmsEmbeds',
      fieldName: 'format',
      fieldId: 'fldFormat',
      add: ['basic_html', 'json', 'xml', 'ical'],
    })
  })

  it('is not "nothing to do", which is how it stayed invisible', () => {
    // The regression in one line. `planIsEmpty` read only createTables and addFields, so
    // this base reported that it already matched the declaration.
    expect(planIsEmpty(planSchema(NARROW, DECLARED))).toBe(false)
  })

  it('sends the surviving choice back with its id, or the patch would delete it', () => {
    const patch = choicePatchFor(planSchema(NARROW, DECLARED).choiceAdds[0])

    // Existing first, carrying its id. A PATCH replaces the list, so a payload without
    // this entry asks Airtable to drop a choice that records are using.
    expect(patch[0]).toEqual({ id: 'selStyled', name: 'styled_html' })
    // New ones by name only. Giving them an id would claim they already exist.
    expect(patch.slice(1)).toEqual([
      { name: 'basic_html' },
      { name: 'json' },
      { name: 'xml' },
      { name: 'ical' },
    ])
  })
})

describe('what it refuses to touch', () => {
  it('plans nothing when every declared choice is present', () => {
    const wide: readonly ExistingTable[] = [
      {
        id: 'tblEmbeds',
        name: 'CmsEmbeds',
        fields: [
          { id: 'fldName', name: 'name', type: 'singleLineText' },
          {
            id: 'fldFormat',
            name: 'format',
            type: 'singleSelect',
            options: {
              choices: ['styled_html', 'basic_html', 'json', 'xml', 'ical'].map((name) => ({
                id: `sel_${name}`,
                name,
              })),
            },
          },
        ],
      },
    ]

    expect(planSchema(wide, DECLARED).choiceAdds).toEqual([])
    expect(planIsEmpty(planSchema(wide, DECLARED))).toBe(true)
  })

  it('keeps a choice the base has and the declaration does not', () => {
    // Same rule the rest of the diff follows: it asks whether what was declared is
    // present, never whether anything present was undeclared. An organizer who added an
    // option by hand does not lose it to a migration.
    const extra: readonly ExistingTable[] = [
      {
        id: 'tblEmbeds',
        name: 'CmsEmbeds',
        fields: [
          { id: 'fldName', name: 'name', type: 'singleLineText' },
          {
            id: 'fldFormat',
            name: 'format',
            type: 'singleSelect',
            options: {
              choices: [
                { id: 'selStyled', name: 'styled_html' },
                { id: 'selHand', name: 'organizer_added_this' },
              ],
            },
          },
        ],
      },
    ]

    const patch = choicePatchFor(planSchema(extra, DECLARED).choiceAdds[0])
    expect(patch).toContainEqual({ id: 'selHand', name: 'organizer_added_this' })
    expect(patch.filter((choice) => choice.name === 'organizer_added_this')).toHaveLength(1)
  })

  it('leaves a field whose TYPE disagrees to the mismatch report', () => {
    // A select declared over a text column is a different problem with a different answer:
    // it is reported and left alone. Widening it would be altering a column this script
    // has always refused to alter.
    const asText: readonly ExistingTable[] = [
      {
        id: 'tblEmbeds',
        name: 'CmsEmbeds',
        fields: [
          { id: 'fldName', name: 'name', type: 'singleLineText' },
          { id: 'fldFormat', name: 'format', type: 'singleLineText' },
        ],
      },
    ]

    const plan = planSchema(asText, DECLARED)
    expect(plan.choiceAdds).toEqual([])
    expect(plan.mismatches).toHaveLength(1)
  })

  it('plans nothing for a select the base reports without an id', () => {
    // A PATCH is addressed by field id. Without one this cannot act, and guessing would
    // mean patching some other field. Silence, and the next run reads the schema again.
    const noId: readonly ExistingTable[] = [
      {
        id: 'tblEmbeds',
        name: 'CmsEmbeds',
        fields: [
          { id: 'fldName', name: 'name', type: 'singleLineText' },
          {
            name: 'format',
            type: 'singleSelect',
            options: { choices: [{ id: 'selStyled', name: 'styled_html' }] },
          },
        ],
      },
    ]

    expect(planSchema(noId, DECLARED).choiceAdds).toEqual([])
  })

  it('does not plan a widening for a select it is about to create', () => {
    // A brand new table's select arrives with its full vocabulary in the create payload,
    // so a widening on top of it would PATCH a field that does not exist yet. The plan is
    // built from the base as it was BEFORE any pass ran, which is what keeps the two
    // apart.
    const plan = planSchema([], DECLARED)
    expect(plan.createTables).toHaveLength(1)
    expect(plan.choiceAdds).toEqual([])
  })
})
