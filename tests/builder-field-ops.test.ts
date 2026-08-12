// The question-list operations, including the three cases that are tedious to reproduce
// by hand in the builder: deleting a question that another question's condition depends
// on, deleting the question a routing rule fires on, and trying to delete a locked
// system field.

import { describe, expect, it } from 'vitest'
import { registryField } from '@/constants/fields'
import {
  addField,
  availableControllers,
  fieldFromRegistry,
  fieldFromType,
  moveField,
  pruneRouting,
  removeField,
  reorderFields,
  routableFields,
  updateField,
} from '@/features/forms/builder/field-ops'
import type { FormField } from '@/types/forms'

const FORMAT: FormField = {
  id: 'a',
  type: 'select',
  label: 'Format',
  required: true,
  options: [
    { value: 'talk', label: 'Talk' },
    { value: 'workshop', label: 'Workshop' },
  ],
}
const LAB: FormField = {
  id: 'b',
  type: 'text',
  label: 'Lab setup',
  required: true,
  showIf: { fieldId: 'a', op: 'eq', value: 'workshop' },
}
const NOTES: FormField = { id: 'c', type: 'text', label: 'Notes', required: false }

describe('fieldFromType', () => {
  it('gives a text field the 255 cap the row chip shows and no registry key', () => {
    const field = fieldFromType('text', 'x')

    expect(field.maxLen).toBe(255)
    expect(field.registryKey).toBeUndefined()
  })

  it('gives a wysiwyg field the 5,000 cap', () => {
    expect(fieldFromType('wysiwyg', 'x').maxLen).toBe(5000)
  })

  it('starts a choice type with an empty option list to edit, and others with none', () => {
    expect(fieldFromType('select', 'x').options).toEqual([])
    expect(fieldFromType('email', 'x').options).toBeUndefined()
  })
})

describe('fieldFromRegistry', () => {
  it('stamps the registry key, which is what sends the answer to a typed column', () => {
    const title = registryField('title')
    expect(title).toBeDefined()
    if (title === undefined) return

    const field = fieldFromRegistry(title, 'x')

    expect(field.registryKey).toBe('title')
    expect(field.locked).toBe(true)
    // A locked field renders with Required on and disabled, so it is created required.
    expect(field.required).toBe(true)
    expect(field.maxLen).toBe(255)
  })

  it('creates an unlocked registry field as optional', () => {
    const level = registryField('level')
    expect(level).toBeDefined()
    if (level === undefined) return

    expect(fieldFromRegistry(level, 'x').required).toBe(false)
  })
})

describe('removeField', () => {
  it('clears a condition that depended on the deleted question', () => {
    const fields = removeField([FORMAT, LAB], 'a')

    expect(fields).toHaveLength(1)
    expect(fields.at(0)?.showIf).toBeUndefined()
  })

  it('refuses to delete a locked system field', () => {
    const locked: FormField = { ...FORMAT, locked: true }

    expect(removeField([locked, LAB], 'a')).toHaveLength(2)
  })

  it('leaves the list alone for an id that is not on it', () => {
    const fields = [FORMAT, LAB]

    expect(removeField(fields, 'nope')).toBe(fields)
  })
})

describe('pruneRouting', () => {
  it('drops the rules that fired on the deleted question and keeps the default', () => {
    const routing = pruneRouting(
      {
        rules: [
          { when: { fieldId: 'a', op: 'eq', value: 'workshop' }, trackId: 'recInfra' },
          { when: { fieldId: 'c', op: 'answered' }, trackId: 'recAgents' },
        ],
        defaultTrackId: 'recProduct',
      },
      'a',
    )

    expect(routing.rules).toHaveLength(1)
    expect(routing.defaultTrackId).toBe('recProduct')
  })
})

describe('moveField and reorderFields', () => {
  it('moves a question one step and clamps at both ends', () => {
    expect(moveField([FORMAT, LAB, NOTES], 'b', -1).map((f) => f.id)).toEqual(['b', 'a', 'c'])
    expect(moveField([FORMAT, LAB, NOTES], 'a', -1).map((f) => f.id)).toEqual(['a', 'b', 'c'])
    expect(moveField([FORMAT, LAB, NOTES], 'c', 1).map((f) => f.id)).toEqual(['a', 'b', 'c'])
  })

  it('drops a dragged question where the one it was dropped on sits', () => {
    expect(reorderFields([FORMAT, LAB, NOTES], 'c', 'a').map((f) => f.id)).toEqual(['c', 'a', 'b'])
  })

  it('leaves the order alone when a drag ends on itself', () => {
    const fields = [FORMAT, LAB, NOTES]

    expect(reorderFields(fields, 'a', 'a')).toBe(fields)
  })
})

describe('availableControllers', () => {
  it('offers only the questions asked before this one', () => {
    const ids = availableControllers([FORMAT, LAB, NOTES], 'b').map((field) => field.id)

    expect(ids).toEqual(['a'])
  })

  it('excludes a question that is itself conditional, so no chain can be authored', () => {
    // One dependency level, per BUILD_SPEC 5.1. `visibleFields` resolves a chain, but
    // the builder must not let one be built.
    const ids = availableControllers([FORMAT, LAB, NOTES], 'c').map((field) => field.id)

    expect(ids).toEqual(['a'])
  })
})

describe('routableFields', () => {
  it('offers only questions with a fixed option list, since a rule matches a value', () => {
    expect(routableFields([FORMAT, LAB, NOTES]).map((field) => field.id)).toEqual(['a'])
  })
})

describe('addField and updateField', () => {
  it('appends to the end, which is where + Add Field puts a new row', () => {
    expect(addField([FORMAT], NOTES).map((field) => field.id)).toEqual(['a', 'c'])
  })

  it('patches one field and refuses to let a patch change its id', () => {
    const fields = updateField([FORMAT, NOTES], 'c', { label: 'Speaker notes', id: 'hijacked' })

    expect(fields.at(1)?.label).toBe('Speaker notes')
    expect(fields.at(1)?.id).toBe('c')
  })
})
