// Form definition types: the shape stored in `Forms.fieldsJson`, `rolesJson`, and
// `routingJson`, and shared by the builder, the public wizard, and the server-side
// re-validation. One definition, three consumers, so it lives in types/ rather
// than inside any one feature.

import type { FormEntityKind, ParticipantRole, TaskEntityType } from '@/constants/status'
import type { RecordId } from '@/types/domain'

export const FIELD_TYPES = [
  'text',
  'wysiwyg',
  'email',
  'phone',
  'select',
  'multiselect',
  'radio',
  'checkbox',
  'file',
  'url',
  'video',
  'number',
  'datetime',
  'speaker_bio',
  'speaker_headshot',
] as const

export type FieldType = (typeof FIELD_TYPES)[number]

/**
 * Row labels exactly as the product renders them, which is not the same as the
 * type name: `select` shows as "Dropdown". Read off the builder screenshots, and
 * familiarity is a scored axis. See docs/parity/submission-form-builder.md.
 */
export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  wysiwyg: 'Wysiwyg',
  email: 'Email',
  phone: 'Phone',
  select: 'Dropdown',
  multiselect: 'Multi-Select',
  radio: 'Radio',
  checkbox: 'Checkbox',
  file: 'File',
  url: 'URL',
  video: 'Video',
  number: 'Number',
  datetime: 'Date & Time',
  speaker_bio: 'Biography',
  speaker_headshot: 'Headshot',
}

/** Default character caps by type, shown as a chip on the builder row. */
export const DEFAULT_MAX_LEN: Partial<Record<FieldType, number>> = {
  text: 255,
  wysiwyg: 5000,
  speaker_bio: 5000,
  url: 2048,
  video: 2048,
}

export type FieldOption = { value: string; label: string }

export type FieldCondition = {
  fieldId: string
  op: 'eq' | 'neq' | 'in' | 'answered'
  value?: string | readonly string[]
}

export type FormField = {
  /** nanoid, stable across edits so answers keep pointing at the right question. */
  id: string
  type: FieldType
  label: string
  help?: string
  required: boolean
  options?: readonly FieldOption[]
  /** One dependency level only, evaluated client-side and again on the server. */
  showIf?: FieldCondition
  maxLen?: number
  /**
   * `RegistryField.key` when this field came from the library, absent when an
   * organizer added it locally. The only thing allowed to decide where the answer
   * is stored: the registry says whether a key is a first-class Airtable column or
   * an `answersJson` entry (BUILD_SPEC section 3), and nothing else can.
   *
   * Not derivable from the rest of this type, which is the point. A local select
   * labelled "Format" is structurally identical to the registry's Format field, so
   * inferring from label, type or lock state writes a local answer into a column
   * that belongs to a different question. See `@/features/forms/answer-storage`.
   */
  registryKey?: string
  /**
   * System field: rendered with a Locked badge, Required toggle on and disabled,
   * still draggable. Title is the locked system field on abstract forms.
   */
  locked?: boolean
  /** Set when the answer writes through to the Speakers record instead of answers. */
  mapsToSpeakerField?: 'bio' | 'headshotUrl'
}

export type ParticipantRoleRule = {
  role: ParticipantRole
  enabled: boolean
  min: number
  max: number
}

export type RoutingRule = {
  when: FieldCondition
  trackId: RecordId
}

export type RoutingConfig = {
  rules: readonly RoutingRule[]
  /** Applied when no rule matches. */
  defaultTrackId?: RecordId
}

export type CrossFieldLimit = {
  fieldIds: readonly string[]
  maxLen: number
  /** Applied per participant when the fields are speaker fields. */
  perParticipant: boolean
}

export type Form = {
  id: RecordId
  eventId: RecordId
  name: string
  /**
   * Opaque, immutable identifier in the public URL. Not a slug: the real product's
   * CFP URL is /submit/<event-slug>/<uuid>, and an opaque id needs no collision
   * policy, no rename handling, and no reserved-word list. See BUILD_SPEC §3.
   */
  publicId: string
  kind: 'cfp' | 'task'
  entityKind: FormEntityKind
  /**
   * Portal forms only (`kind: 'task'`): who the form is addressed to, in the same
   * vocabulary a Task's own `entityType` uses, because assigning a portal form creates a
   * Task and the two must agree about whether the to-do hangs off a person or a session.
   *
   * Absent on a CFP form, and that is the honest reading rather than a default: a call for
   * papers is answered by strangers who are not yet a contact, a group or a submission.
   */
  entityType?: TaskEntityType
  participantsEnabled: boolean
  status: 'draft' | 'published'
  /**
   * The participant-facing title, which is not `name`.
   *
   * `name` is the internal one an organizer searches the forms list by ("Session
   * Submission Form #4"); this is what a stranger reads at the top of the public page
   * ("Welcome to our event!"). Optional rather than defaulted, because every form that
   * existed before the column did has it empty and the public page falls back to `name`
   * rather than rendering a blank heading.
   */
  externalTitle?: string
  /**
   * The public wizard's rail label for the Welcome step, capped at 15 characters in the
   * product ("Welcome!"). The three `*Heading` fields are short for that reason: they are
   * step labels, not page copy, which is what ref 16's rail confirms.
   */
  welcomeHeading?: string
  welcomeHtml?: string
  /** The heading over the abstract questions ("Tell us about your submission"). */
  abstractSectionTitle?: string
  /** Rail label for the Submission step ("Submission"). */
  abstractHeading?: string
  /** Rich text shown above the abstract questions. Organizer-authored, like `welcomeHtml`. */
  abstractSectionHtml?: string
  /** The heading over the participant questions ("Tell us about you"). */
  participantSectionTitle?: string
  /** Rail label for the Participant step ("Participant"). */
  participantHeading?: string
  /** Rich text shown above the participant questions. */
  participantSectionHtml?: string
  successHtml?: string
  fields: readonly FormField[]
  participantFields: readonly FormField[]
  routing: RoutingConfig
  roles: readonly ParticipantRoleRule[]
  crossFieldLimits: readonly CrossFieldLimit[]
  closeDate?: string
  submissionLimit?: number
  allowMultipleDrafts: boolean
  autoRedirectToPortal: boolean
  confirmationEmailEnabled: boolean
  confirmationEmailHtml?: string
  adminAlertOnNew: readonly string[]
  adminAlertOnUpdate: readonly string[]
}

/**
 * A form's content, without its identity: everything the builder edits and the DAL
 * writes back. `id`, `eventId`, `publicId` and `kind` are assigned once at creation and
 * never edited, and `status` moves through publish rather than through a content save,
 * so keeping them out of this type is what stops a save from rewriting them.
 */
export type FormContent = Omit<Form, 'id' | 'eventId' | 'publicId' | 'kind' | 'status'>

/**
 * Derived, never stored. The UI shows Open/Closed tabs while the column is
 * draft/published, and conflating the two is how a draft ends up on a public tab.
 */
export type FormPublicState = 'draft' | 'open' | 'closed'

export function formPublicState(
  form: Pick<Form, 'status' | 'closeDate'>,
  now: Date,
): FormPublicState {
  if (form.status === 'draft') return 'draft'
  if (form.closeDate === undefined) return 'open'
  return Date.parse(form.closeDate) > now.getTime() ? 'open' : 'closed'
}
