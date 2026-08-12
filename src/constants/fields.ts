// The field registry: one declaration of every session and participant field.
//
// This is Sessionboard's Library > Fields, code-defined rather than admin-editable
// (BUILD_SPEC §3). Four surfaces read it and none of them may keep their own list:
//   - the DataTable Columns/Sort/Filter preferences drawer
//   - the form builder's "add existing field" picker
//   - the portal form builder's field picker
//   - Event Settings > Library > Fields, which just renders it read-only
//
// `column: true` means the value lives in a first-class Airtable column and is
// therefore sortable and filterable. `column: false` means it lands in
// `answersJson`. That split is the structural decision in §3: the Abstracts table
// sorts and filters on every default column, and a JSON blob cannot do that.

import { PARTICIPANT_FIELDS } from '@/constants/participant-fields'
import { SPEAKER_CRM_DEFAULT_COLUMN_KEYS, SPEAKER_CRM_FIELDS } from '@/constants/speaker-crm-fields'
import type { FieldType } from '@/types/forms'

export { PARTICIPANT_FIELDS, SPEAKER_CRM_DEFAULT_COLUMN_KEYS, SPEAKER_CRM_FIELDS }

export type FieldGroup = 'session' | 'scheduling' | 'classification' | 'participant' | 'reporting'

export type RegistryField = {
  /** Stable key. For columns this matches the Submission property name. */
  key: string
  label: string
  type: FieldType
  group: FieldGroup
  /** True when this is a real Airtable column rather than an answersJson entry. */
  column: boolean
  /** Shown in the DataTable's default column set. */
  defaultVisible: boolean
  /** Cannot be removed from a form; renders with a Locked badge. */
  locked?: boolean
  maxLen?: number
  /** Info tooltip copy on the column header and the builder row. */
  help?: string
}

export const SESSION_FIELDS: readonly RegistryField[] = [
  {
    key: 'code',
    label: 'ID',
    type: 'text',
    group: 'session',
    column: true,
    defaultVisible: true,
    help: 'System-assigned identifier, shown to speakers as SESS-<n>.',
  },
  {
    key: 'title',
    label: 'Title',
    type: 'text',
    group: 'session',
    column: true,
    defaultVisible: true,
    locked: true,
    maxLen: 255,
    help: 'The session title as it appears to reviewers, on the agenda, and to speakers.',
  },
  {
    key: 'status',
    label: 'Status',
    type: 'select',
    group: 'session',
    column: true,
    defaultVisible: true,
    help: 'Where this submission sits in the review lifecycle.',
  },
  {
    key: 'source',
    label: 'Source',
    type: 'select',
    group: 'session',
    column: true,
    defaultVisible: true,
    help: 'The form this arrived through, or Manual when an organizer entered it.',
  },
  {
    key: 'description',
    label: 'Description',
    type: 'wysiwyg',
    group: 'session',
    column: false,
    defaultVisible: false,
    maxLen: 5000,
    help: 'The abstract body. Long text, so it is stored as an answer rather than a sortable column.',
  },
  {
    key: 'format',
    label: 'Format',
    type: 'select',
    group: 'classification',
    column: true,
    defaultVisible: true,
    help: 'The session shape a speaker asked for: talk, workshop, panel, and so on.',
  },
  {
    key: 'level',
    label: 'Level',
    type: 'select',
    group: 'classification',
    column: true,
    defaultVisible: false,
    help: 'Who the session is pitched at. Set by the speaker, not inferred from the abstract.',
  },
  {
    key: 'language',
    label: 'Language',
    type: 'select',
    group: 'classification',
    column: true,
    defaultVisible: false,
    help: 'The language the session is delivered in. Not an interface language.',
  },
  {
    key: 'track',
    label: 'Track',
    type: 'select',
    group: 'classification',
    column: true,
    defaultVisible: true,
    help: 'Also the review category: routing sets it and reviewers are assigned by it.',
  },
  {
    key: 'tags',
    label: 'Tags',
    type: 'multiselect',
    group: 'classification',
    column: true,
    defaultVisible: true,
    help: 'Free-form labels for grouping. Unlike Track, tags carry no reviewer assignment.',
  },
  {
    key: 'ceuCredits',
    label: 'CEU Credits',
    type: 'number',
    group: 'classification',
    column: true,
    defaultVisible: false,
    help: 'Continuing-education credits this session is worth, where the event awards them.',
  },
  {
    key: 'startsAt',
    label: 'Starts At',
    type: 'datetime',
    group: 'scheduling',
    column: true,
    defaultVisible: true,
    help: 'When the session begins, in the event timezone. Empty until it is scheduled.',
  },
  {
    key: 'endsAt',
    label: 'Ends At',
    type: 'datetime',
    group: 'scheduling',
    column: true,
    defaultVisible: true,
    help: 'When the session ends. Together with Starts At this is what conflict detection reads.',
  },
  {
    key: 'room',
    label: 'Room',
    type: 'select',
    group: 'scheduling',
    column: true,
    defaultVisible: true,
    help: 'The room the session is scheduled into. Two sessions sharing one is a conflict.',
  },
  {
    key: 'scheduleStatus',
    label: 'Schedule Status',
    type: 'select',
    group: 'scheduling',
    column: true,
    defaultVisible: false,
    help: 'Unscheduled, Scheduled, or Published. Only Published rows appear publicly.',
  },
  {
    key: 'capacity',
    label: 'Capacity',
    type: 'number',
    group: 'scheduling',
    column: true,
    defaultVisible: false,
    help: 'Seats available, where the room or the format limits it.',
  },
  {
    key: 'location',
    label: 'Location',
    type: 'text',
    group: 'scheduling',
    column: true,
    defaultVisible: false,
    help: 'Free-text venue detail for a session that is not in one of the event rooms.',
  },
  {
    key: 'clientSessionId',
    // "Client Session ID" is what the product puts on the column header, the Columns
    // picker and the Sort field list (refs 19, 21, 22). "Client ID" is the label on the
    // Add Abstract field only (ref 23), and that sheet hardcodes its own label, so the
    // registry carries the table-side wording.
    label: 'Client Session ID',
    type: 'text',
    group: 'session',
    column: true,
    defaultVisible: false,
    help: 'Your own reference for this session. Never shown to speakers.',
  },
  {
    key: 'chairperson',
    label: 'Chairperson',
    type: 'text',
    group: 'session',
    // Derived, not stored. `chairperson` is one of the four PARTICIPANT_ROLES
    // (src/constants/status.ts), so the value is the SubmissionParticipants rows on this
    // submission that hold that role. `column: false` for the same reason `ratings` is:
    // there is no Submissions column behind it, so it cannot be sorted or filtered on the
    // server. Ref 21 shows it unchecked in the Columns picker, which is why it is not in
    // the default set.
    column: false,
    defaultVisible: false,
    help: 'The participant assigned the chairperson role, where the session has one.',
  },
  {
    key: 'notifiedAt',
    label: 'Notified',
    type: 'datetime',
    group: 'reporting',
    column: true,
    defaultVisible: true,
    help: 'When the accept or decline email was sent. Empty means not yet notified.',
  },
  {
    key: 'submittedAt',
    label: 'Submitted',
    type: 'datetime',
    group: 'reporting',
    column: true,
    defaultVisible: true,
    help: 'When the speaker submitted. Empty for an abstract an organizer entered by hand.',
  },
  {
    key: 'ratings',
    label: 'Ratings',
    type: 'number',
    group: 'reporting',
    column: false,
    defaultVisible: true,
    help: 'Weighted average across reviewers for the active round, with the review count.',
  },
]

export const ALL_REGISTRY_FIELDS: readonly RegistryField[] = [
  ...SESSION_FIELDS,
  ...PARTICIPANT_FIELDS,
]

/** Lookup by key. A Map, not object indexing, so a dynamic key is safe. */
const BY_KEY = new Map(ALL_REGISTRY_FIELDS.map((field) => [field.key, field]))

export function registryField(key: string): RegistryField | undefined {
  return BY_KEY.get(key)
}

/** The DataTable's out-of-the-box column set. */
export const DEFAULT_COLUMN_KEYS: readonly string[] = SESSION_FIELDS.filter(
  (field) => field.defaultVisible,
).map((field) => field.key)

/**
 * The Preferences drawer has Fields / Reporting Fields toggle pills, so the
 * registry has to be able to answer which is which.
 *
 * `catalog` defaults to the session fields, which is the only catalog the drawer had
 * when it was written. The speaker CRM passes `SPEAKER_CRM_FIELDS` instead: it is a
 * different table over a different row type, and offering it Track and Room would be
 * offering columns that surface can never render.
 */
export function fieldsForPill(
  pill: 'fields' | 'reporting',
  catalog: readonly RegistryField[] = SESSION_FIELDS,
): readonly RegistryField[] {
  return catalog.filter((field) =>
    pill === 'reporting' ? field.group === 'reporting' : field.group !== 'reporting',
  )
}
