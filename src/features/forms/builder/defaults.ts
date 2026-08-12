// What "Create Form" produces.
//
// Not a blank form. BUILD_SPEC 5.1 seeds the abstract set (Title locked, Description,
// Format, Tags, Track, Level) and the participant set (First Name, Last Name, Email,
// Mobile Phone, Biography), and the parity doc transcribes exactly those rows off the
// real product with those types and those caps. Every one of them comes out of the field
// registry rather than being declared again here, so each carries its `registryKey` and
// its answer reaches a typed column instead of `answersJson`.
//
// The roles default is `DEFAULT_PARTICIPANT_ROLES`, and the note on that constant is
// worth reading before changing it: a default that requires two speakers blocks a solo
// submitter at the exact moment a stranger is trying to give you a talk.

import { PARTICIPANT_FIELDS, type RegistryField, SESSION_FIELDS } from '@/constants/fields'
import { DEFAULT_PARTICIPANT_ROLES } from '@/constants/status'
import type { FormDraft } from '@/features/forms/builder/draft'
import { fieldFromRegistry } from '@/features/forms/builder/field-ops'
import { DEFAULT_FORM_HEADINGS } from '@/features/forms/builder/headings'
import type { FormField } from '@/types/forms'

/** Registry keys of the default abstract questions, in the order the product shows. */
export const DEFAULT_ABSTRACT_KEYS: readonly string[] = [
  'title',
  'description',
  'format',
  'tags',
  'track',
  'level',
]

/** Registry keys of the default participant questions, in the transcribed order. */
export const DEFAULT_PARTICIPANT_KEYS: readonly string[] = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'bio',
]

/** The default questions the product shows with the Required toggle off. */
const OPTIONAL_KEYS: readonly string[] = ['level', 'phone', 'bio']

/**
 * Whether a seeded question starts required.
 *
 * The last clause is a safety net rather than a preference: a REQUIRED choice question
 * with no options is a control nobody can answer, so the form it seeds would be
 * impossible to submit. Track and Tags come from the event's own records, and an event
 * with no tracks yet would otherwise get exactly that. Seeded optional, the organizer
 * can add options and turn Required on.
 */
function seedRequired(input: {
  key: string
  locked: boolean
  options: readonly NamedOption[] | undefined
}): boolean {
  if (input.locked) return true
  if (OPTIONAL_KEYS.includes(input.key)) return false
  return input.options === undefined || input.options.length > 0
}

/**
 * The Format options the seeded event uses. A dropdown with no options is a question
 * nobody can answer, and shipping "Create Form" with three unanswerable required
 * questions would make the first form an organizer builds impossible to submit.
 * Track options are filled in from the event's own tracks by the caller.
 */
const SEED_OPTIONS: ReadonlyMap<string, readonly { value: string; label: string }[]> = new Map([
  [
    'format',
    [
      { value: 'talk', label: 'Talk (30 min)' },
      { value: 'workshop', label: 'Workshop (90 min)' },
      { value: 'panel', label: 'Panel' },
    ],
  ],
  [
    'level',
    [
      { value: 'beginner', label: 'Beginner' },
      { value: 'intermediate', label: 'Intermediate' },
      { value: 'advanced', label: 'Advanced' },
    ],
  ],
])

export type NamedOption = { value: string; label: string }

/**
 * Field definitions for a list of registry keys.
 *
 * `ids` is passed in, one per key, so the caller owns `nanoid()` and this stays
 * deterministic under test. A key the registry does not know is skipped rather than
 * invented, because a field with a registry key nothing can place writes its answer
 * nowhere (see `splitAnswers`).
 */
export function fieldsForKeys(input: {
  keys: readonly string[]
  registry: readonly RegistryField[]
  ids: readonly string[]
  /** Option lists that only the event knows, keyed by registry key. Track, mainly. */
  options?: ReadonlyMap<string, readonly NamedOption[]>
}): readonly FormField[] {
  const byKey = new Map(input.registry.map((field) => [field.key, field]))
  const fields: FormField[] = []

  input.keys.forEach((key, index) => {
    const registry = byKey.get(key)
    const id = input.ids.at(index)
    if (registry === undefined || id === undefined) return
    const base = fieldFromRegistry(registry, id)
    const options = input.options?.get(key) ?? SEED_OPTIONS.get(key) ?? base.options
    fields.push({
      ...base,
      required: seedRequired({ key, locked: registry.locked === true, options }),
      options,
    })
  })

  return fields
}

/**
 * A new form's draft. `ids` must hold at least one id per default question across both
 * sets, which the caller mints with `nanoid()`.
 */
export function newFormDraft(input: {
  name: string
  ids: readonly string[]
  /** The event's categories, as the Track dropdown's options. Values are record ids. */
  trackOptions?: readonly NamedOption[]
  tagOptions?: readonly NamedOption[]
}): FormDraft {
  const abstractIds = input.ids.slice(0, DEFAULT_ABSTRACT_KEYS.length)
  const participantIds = input.ids.slice(DEFAULT_ABSTRACT_KEYS.length)
  const options: Map<string, readonly NamedOption[]> = new Map()
  if (input.trackOptions !== undefined && input.trackOptions.length > 0) {
    options.set('track', input.trackOptions)
  }
  if (input.tagOptions !== undefined && input.tagOptions.length > 0) {
    options.set('tags', input.tagOptions)
  }

  return {
    // Participant-facing copy, transcribed off the builder screenshots the same way
    // `DEFAULT_WELCOME_HTML` below is. See the note on DEFAULT_FORM_HEADINGS.
    ...DEFAULT_FORM_HEADINGS,
    name: input.name,
    entityKind: 'abstracts',
    participantsEnabled: true,
    welcomeEnabled: true,
    welcomeHtml: DEFAULT_WELCOME_HTML,
    successHtml: DEFAULT_SUCCESS_HTML,
    fields: fieldsForKeys({
      keys: DEFAULT_ABSTRACT_KEYS,
      registry: SESSION_FIELDS,
      ids: abstractIds,
      options,
    }),
    participantFields: fieldsForKeys({
      keys: DEFAULT_PARTICIPANT_KEYS,
      registry: PARTICIPANT_FIELDS,
      ids: participantIds,
    }),
    routing: { rules: [], defaultTrackId: undefined },
    roles: DEFAULT_PARTICIPANT_ROLES,
    crossFieldLimits: [],
    closeDate: '',
    submissionLimitEnabled: false,
    submissionLimit: '',
    allowMultipleDrafts: false,
    autoRedirectToPortal: true,
    confirmationEmailEnabled: true,
    confirmationEmailHtml: DEFAULT_CONFIRMATION_HTML,
    adminAlertOnNew: [],
    adminAlertOnUpdate: [],
  }
}

/** Copy from the Welcome Screen screenshot, which is the product's own default. */
export const DEFAULT_WELCOME_HTML =
  '<p><strong>Call for Speakers</strong></p><p>Sessions for our agenda will be selected from these submissions.</p>'

export const DEFAULT_SUCCESS_HTML =
  '<p>You will receive a confirmation email shortly with a link to your speaker portal. We will review sessions over the next few weeks and then notify you regarding your status.</p>'

export const DEFAULT_CONFIRMATION_HTML =
  '<p>We got your submission. Manage it any time from your speaker portal.</p>'

/** How many ids `newFormDraft` needs. */
export const NEW_FORM_ID_COUNT = DEFAULT_ABSTRACT_KEYS.length + DEFAULT_PARTICIPANT_KEYS.length
