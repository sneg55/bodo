// Locked system fields on a submission form, enforced on the SERVER as well as in the editor.
//
// The reference states the rule for both halves of the form: on Session information "The
// `Page Heading` is required and cannot be deleted", and on Speaker information
// "`First Name`, `Last Name`, and `Email` are mandatory and cannot be deleted"
// (docs/parity/external-references.md). Our own screenshot names the session-side field
// `Title`, which is the label this build keeps; the reference settles the behaviour and the
// fact that the speaker-side trio is locked too.
//
// The editor's refusal (`removeField`) is covered in tests/builder-field-ops.test.ts. What is
// pinned here is the pair the save action uses, because a delete that only the client refuses
// is not enforced: `saveFormAction` takes the whole field list from a POST.

import { describe, expect, it } from 'vitest'

import { PARTICIPANT_FIELDS, SESSION_FIELDS } from '@/constants/fields'
import {
  DEFAULT_ABSTRACT_KEYS,
  DEFAULT_PARTICIPANT_KEYS,
  fieldsForKeys,
} from '@/features/forms/builder/defaults'
import { missingLockedFields, withLocksRestored } from '@/features/forms/builder/field-ops'
import type { FormField } from '@/types/forms'

const ABSTRACT = fieldsForKeys({
  keys: DEFAULT_ABSTRACT_KEYS,
  registry: SESSION_FIELDS,
  ids: DEFAULT_ABSTRACT_KEYS.map((key) => `f_${key}`),
})

const PARTICIPANT = fieldsForKeys({
  keys: DEFAULT_PARTICIPANT_KEYS,
  registry: PARTICIPANT_FIELDS,
  ids: DEFAULT_PARTICIPANT_KEYS.map((key) => `p_${key}`),
})

function labels(fields: readonly FormField[]): readonly string[] {
  return fields.map((field) => field.label)
}

describe('the locked set a submission form seeds', () => {
  it('locks Title on the session half', () => {
    expect(labels(ABSTRACT.filter((field) => field.locked === true))).toEqual(['Title'])
  })

  it('locks First Name, Last Name and Email on the speaker half', () => {
    expect(labels(PARTICIPANT.filter((field) => field.locked === true))).toEqual([
      'First Name',
      'Last Name',
      'Email',
    ])
  })

  it('has every locked field required, which is what mandatory means here', () => {
    const locked = [...ABSTRACT, ...PARTICIPANT].filter((field) => field.locked === true)

    expect(locked.every((field) => field.required)).toBe(true)
  })
})

describe('missingLockedFields', () => {
  it('names a locked field a save has dropped', () => {
    const next = ABSTRACT.filter((field) => field.label !== 'Title')

    expect(labels(missingLockedFields(ABSTRACT, next))).toEqual(['Title'])
  })

  it('names every one of the speaker trio when a save drops all three', () => {
    const next = PARTICIPANT.filter((field) => field.locked !== true)

    expect(labels(missingLockedFields(PARTICIPANT, next))).toEqual([
      'First Name',
      'Last Name',
      'Email',
    ])
  })

  it('says nothing about an ordinary field being deleted, which is an ordinary edit', () => {
    const next = ABSTRACT.filter((field) => field.label !== 'Level')

    expect(missingLockedFields(ABSTRACT, next)).toEqual([])
  })

  it('says nothing when the list is reordered rather than shortened', () => {
    expect(missingLockedFields(ABSTRACT, [...ABSTRACT].reverse())).toEqual([])
  })
})

describe('withLocksRestored', () => {
  it('puts back a lock that a save cleared, and the Required it carries with it', () => {
    // Deleting the row is the loud way to unlock a system field; clearing the two flags is the
    // quiet way to the same place, and both arrive as an ordinary-looking draft.
    const demoted = ABSTRACT.map((field) =>
      field.locked === true ? { ...field, locked: false, required: false } : field,
    )

    const restored = withLocksRestored(ABSTRACT, demoted)
    const title = restored.find((field) => field.label === 'Title')

    expect(title?.locked).toBe(true)
    expect(title?.required).toBe(true)
  })

  it('strips a showIf a save put on a locked field, which is the third way to demote it', () => {
    // Restoring `locked` and `required` alone does not close this. Validation runs over
    // `visibleFields`, so a locked field that is still required but conditioned on an answer
    // that does not match is never checked, and the submission is titled "Untitled submission"
    // exactly as if Title had been optional. A system field is unconditional by definition and
    // the builder offers no rule on one, so nothing legitimate is lost. Found by Codex review.
    const conditioned = ABSTRACT.map((field) =>
      field.locked === true
        ? { ...field, showIf: { fieldId: 'f_format', op: 'eq' as const, value: 'never' } }
        : field,
    )

    const title = withLocksRestored(ABSTRACT, conditioned).find((field) => field.label === 'Title')

    expect(title?.showIf).toBeUndefined()
    expect(title?.required).toBe(true)
  })

  it('leaves a showIf on an ordinary field alone', () => {
    const rule = { fieldId: 'f_format', op: 'eq' as const, value: 'workshop' }
    const conditioned = ABSTRACT.map((field) =>
      field.label === 'Format' ? field : { ...field, showIf: rule },
    )

    const restored = withLocksRestored(ABSTRACT, conditioned)
    const unlocked = restored.find((field) => field.locked !== true && field.label !== 'Format')

    expect(unlocked?.showIf).toEqual(rule)
  })

  it('leaves the Required of an unlocked field exactly as the organizer set it', () => {
    const relaxed = ABSTRACT.map((field) =>
      field.label === 'Format' ? { ...field, required: false } : field,
    )

    const restored = withLocksRestored(ABSTRACT, relaxed)

    expect(restored.find((field) => field.label === 'Format')?.required).toBe(false)
  })

  it('does not lock a field that was never locked, even under the same label', () => {
    // A locally added question can be labelled "Title" too. Locks are restored by id, so this
    // one stays an ordinary question rather than inheriting the system field's status.
    const impostor: FormField = { id: 'f_local', type: 'text', label: 'Title', required: false }

    const restored = withLocksRestored(ABSTRACT, [...ABSTRACT, impostor])

    expect(restored.at(-1)?.locked).toBeUndefined()
  })
})
