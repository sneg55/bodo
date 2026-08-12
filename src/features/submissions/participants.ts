// A participant's answers, turned into the Speakers row the CFP has to write.
//
// BUILD_SPEC section 5.1 says the Participant step "writes to Speakers", so every
// participant question either lands on a Speaker property or it lands nowhere. The
// mapping is driven by `registryKey` and `mapsToSpeakerField`, the two declared
// signals, exactly as `@/features/forms/answer-storage` insists for the submission
// half: a local text field labelled "Biography" must not overwrite the profile bio
// of a returning speaker who has one.
//
// One fallback exists, and it is on TYPE not label: `speaker_bio` and
// `speaker_headshot` are field types whose whole purpose is to write through to the
// profile (see `FormField.mapsToSpeakerField`), so honouring them without a registry
// key costs nothing and loses no answer.

import type { ParticipantRole } from '@/constants/status'
import { answerIndex, answerValues, type FormAnswers } from '@/features/forms/logic'
import type { SpeakerDraft } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'
import type { FormField } from '@/types/forms'

/** The Speaker properties a participant question is allowed to write. */
type SpeakerProp = Extract<
  keyof SpeakerDraft,
  'firstName' | 'lastName' | 'email' | 'phone' | 'bio' | 'company' | 'headshotUrl'
>

/**
 * The three identity values the wizard collects as typed inputs rather than as
 * dynamic questions, because a Speakers row cannot exist without an email and the
 * confirmation email needs a name to address.
 */
type IdentityProp = Extract<SpeakerProp, 'firstName' | 'lastName' | 'email'>

export const IDENTITY_PROPS: readonly IdentityProp[] = ['firstName', 'lastName', 'email']

/** Assignable while a draft is being built up, frozen into `SpeakerDraft` on return. */
type MutableSpeakerDraft = { -readonly [K in keyof SpeakerDraft]: SpeakerDraft[K] }

/**
 * Registry key to Speaker property. Explicit because the names differ where the
 * record differs: the registry calls it `headshot` and the row holds `headshotUrl`.
 * Keys are `@/constants/participant-fields`.
 */
const PROP_BY_REGISTRY_KEY: ReadonlyMap<string, SpeakerProp> = new Map<string, SpeakerProp>([
  ['firstName', 'firstName'],
  ['lastName', 'lastName'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['bio', 'bio'],
  ['company', 'company'],
  ['headshot', 'headshotUrl'],
])

const PROP_BY_SPEAKER_FIELD: ReadonlyMap<string, SpeakerProp> = new Map<string, SpeakerProp>([
  ['bio', 'bio'],
  ['headshotUrl', 'headshotUrl'],
])

function isIdentityProp(prop: SpeakerProp): prop is IdentityProp {
  return prop === 'firstName' || prop === 'lastName' || prop === 'email'
}

/**
 * Which of the form's participant questions the wizard renders itself, so the
 * speaker is not asked for their email twice.
 *
 * A form built from the field registry carries `registryKey` on all three and this
 * resolves off that. The label fallback covers a hand-authored `fieldsJson` where
 * the keys are missing, and it is a PRESENTATION decision only: the answer is still
 * stored under the field's own id and still validated, so a wrong guess duplicates
 * a control rather than misfiling a value. That is the opposite trade from
 * answer-storage, where a wrong guess writes to a column that belongs to another
 * question and nothing ever notices.
 */
export function identityFieldIds(fields: readonly FormField[]): ReadonlyMap<IdentityProp, string> {
  const found = new Map<IdentityProp, string>()

  for (const field of fields) {
    const prop = declaredProp(field)
    if (prop !== undefined && isIdentityProp(prop) && !found.has(prop)) found.set(prop, field.id)
  }

  for (const field of fields) {
    const guess = guessIdentityProp(field)
    if (guess !== undefined && !found.has(guess)) found.set(guess, field.id)
  }

  return found
}

function guessIdentityProp(field: FormField): IdentityProp | undefined {
  if (field.type === 'email') return 'email'
  const label = field.label.trim().toLowerCase()
  if (label === 'first name') return 'firstName'
  if (label === 'last name') return 'lastName'
  return undefined
}

export type ParticipantIdentity = {
  email: string
  firstName: string
  lastName: string
}

/**
 * Puts the typed identity values back under their field ids, so the participant's
 * answer set is complete before `validateAnswers` sees it. Without this a locked,
 * required "Email" question would report as missing on a participant whose email the
 * wizard already has.
 *
 * Built through a Map because assigning `merged[fieldId]` is a dynamic index on a
 * plain object, which also reaches inherited keys.
 */
export function withIdentityAnswers(input: {
  fields: readonly FormField[]
  identity: ParticipantIdentity
  answers: FormAnswers
}): FormAnswers {
  const ids = identityFieldIds(input.fields)
  const merged = new Map(Object.entries(input.answers))
  for (const prop of IDENTITY_PROPS) {
    const fieldId = ids.get(prop)
    if (fieldId === undefined) continue
    merged.set(fieldId, identityValue(input.identity, prop))
  }
  return Object.fromEntries(merged)
}

function identityValue(identity: ParticipantIdentity, prop: IdentityProp): string {
  switch (prop) {
    case 'firstName':
      return identity.firstName
    case 'lastName':
      return identity.lastName
    case 'email':
      return identity.email
  }
}

export type ParticipantRow = {
  role: ParticipantRole
  isPrimary: boolean
  identity: ParticipantIdentity
  answers: FormAnswers
}

/**
 * The Speakers row for one participant. Identity comes from the typed values, and
 * everything else from the declared mapping. Blank answers are left out entirely,
 * because `speakerFields` drops `undefined` and a returning speaker's existing bio
 * must survive a form that did not ask for one.
 */
export function speakerDraftFor(input: {
  participant: ParticipantRow
  fields: readonly FormField[]
  eventId: RecordId
}): SpeakerDraft {
  const draft: MutableSpeakerDraft = {
    email: input.participant.identity.email.trim().toLowerCase(),
    firstName: blankToUndefined(input.participant.identity.firstName),
    lastName: blankToUndefined(input.participant.identity.lastName),
    eventIds: [input.eventId],
  }

  const index = answerIndex(input.participant.answers)
  for (const field of input.fields) {
    const prop = mappedProp(field)
    if (prop === undefined || isIdentityProp(prop)) continue
    // Flattened to a string because every property here is a text column. A
    // multiselect mapped at a speaker field is a builder mistake, and joining is
    // recoverable where dropping the answer is not.
    const value = answerValues(index.get(field.id)).join(' ')
    if (value.length === 0) continue
    assignProp(draft, prop, value)
  }

  return draft
}

function declaredProp(field: FormField): SpeakerProp | undefined {
  if (field.registryKey === undefined) return undefined
  return PROP_BY_REGISTRY_KEY.get(field.registryKey)
}

function mappedProp(field: FormField): SpeakerProp | undefined {
  const byKey = declaredProp(field)
  if (byKey !== undefined) return byKey
  const declared =
    field.mapsToSpeakerField === undefined
      ? undefined
      : PROP_BY_SPEAKER_FIELD.get(field.mapsToSpeakerField)
  if (declared !== undefined) return declared
  if (field.type === 'speaker_bio') return 'bio'
  if (field.type === 'speaker_headshot') return 'headshotUrl'
  return undefined
}

/** A switch rather than `target[prop] = value`, which is a dynamic object index. */
function assignProp(target: MutableSpeakerDraft, prop: SpeakerProp, value: string): void {
  switch (prop) {
    case 'firstName':
      target.firstName = value
      break
    case 'lastName':
      target.lastName = value
      break
    case 'email':
      target.email = value
      break
    case 'phone':
      target.phone = value
      break
    case 'bio':
      target.bio = value
      break
    case 'company':
      target.company = value
      break
    case 'headshotUrl':
      target.headshotUrl = value
      break
  }
}

function blankToUndefined(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}
