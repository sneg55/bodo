// The speaker CRM's column catalog: what the cross-event directory can show, sort and
// filter on.
//
// Its own export rather than an extension of `PARTICIPANT_FIELDS`, and that is the load
// bearing decision here. `PARTICIPANT_FIELDS` feeds the two form builders' field pickers,
// so everything in it is a QUESTION a speaker can be asked. "How many of your events is
// this person on" is not a question anybody answers, it is a count derived from links, and
// putting it in that array would offer it as a form field on every CFP.
//
// Split out of fields.ts for the same reason participant-fields.ts was: to keep both files
// under the 300-line limit. The registry API in fields.ts is still the single entry point.
//
// Every entry carries `help`, because the parity audit requires the info tooltip on EVERY
// column header and `DataTableGrid` renders no icon without it. The wording is AUTHORED:
// the CRM is waived in the parity report and appears in no screenshot, so there is nothing
// to transcribe.

import type { DataTableCatalog } from '@/components/primitives/data-table-types'
import type { RegistryField } from '@/constants/fields'
import { PARTICIPANT_FIELDS } from '@/constants/participant-fields'

/**
 * CRM tooltips for the participant fields, which carry no `help` of their own.
 *
 * Kept here rather than added to `PARTICIPANT_FIELDS`, because `fieldFromRegistry`
 * (features/forms/builder/field-ops.ts:60) copies a registry field's `help` onto the form
 * question it seeds. Filling those in upstream would print organizer-facing column notes
 * under speaker-facing questions on every public CFP form.
 */
const PARTICIPANT_HELP: ReadonlyMap<string, string> = new Map([
  ['firstName', 'Given name, as the speaker entered it. The Name column composes both halves.'],
  ['lastName', 'Family name. The directory sorts on it by default.'],
  ['email', 'The identity a speaker signs in with, and the key an import deduplicates on.'],
  ['phone', 'Mobile number, where the speaker supplied one.'],
  ['bio', 'The biography a speaker maintains in their portal. Flattened to plain text here.'],
  ['company', 'Employer or affiliation, as it appears on public speaker cards.'],
  ['headshot', 'The portrait a speaker uploaded. Shown as an avatar in the table.'],
])

/**
 * The participant half, with two overrides.
 *
 * `defaultVisible` goes false for the two name halves: the directory opens with the
 * composed Name column, and shipping all three would spend a third of the table restating
 * one value. Both stay in the catalog, so an organizer who wants to sort on the family name
 * alone can turn Last Name on.
 */
const CRM_PARTICIPANT_FIELDS: readonly RegistryField[] = PARTICIPANT_FIELDS.map((field) => ({
  ...field,
  defaultVisible:
    field.key === 'firstName' || field.key === 'lastName' ? false : field.defaultVisible,
  help: field.help ?? PARTICIPANT_HELP.get(field.key),
}))

/**
 * `column` is false on everything this file adds, and it is not a mistake.
 *
 * The flag means "this is a first-class Airtable column, so Airtable can sort and filter
 * it". None of these are: `name` is composed, `tags` lives on the SpeakerTags table's link,
 * and the two counts are derived per request. The CRM sorts and filters them anyway,
 * because it does that work in memory over the row model (`features/crm/speaker-rows.ts`),
 * which is the whole reason the directory can offer a condition on a count at all.
 */
const CRM_ONLY_FIELDS: readonly RegistryField[] = [
  {
    key: 'name',
    label: 'Name',
    type: 'text',
    group: 'participant',
    column: false,
    defaultVisible: true,
    help: 'First and last name together. Falls back to the email when a record has neither.',
  },
  {
    key: 'tagline',
    label: 'Tagline',
    type: 'text',
    group: 'participant',
    column: true,
    defaultVisible: true,
    maxLen: 255,
    help: 'The one-line descriptor a speaker gives themselves, shown on public speaker cards.',
  },
  {
    key: 'pronouns',
    label: 'Pronouns',
    type: 'text',
    group: 'participant',
    column: true,
    defaultVisible: false,
    help: 'As the speaker entered them. Never inferred, and never required.',
  },
  {
    key: 'tags',
    label: 'Speaker Tags',
    type: 'multiselect',
    group: 'participant',
    column: false,
    // On by default: tagging is how an organizer segments a cross-event roster, so it is
    // the column that makes the directory a CRM rather than a list of people. Resolved for
    // the whole scope in one read (`listSpeakerTagMembership`), not one per row.
    defaultVisible: true,
    help: 'Cross-event CRM labels. Unlike session tags these belong to the person, not to a submission.',
  },
  {
    key: 'eventCount',
    label: 'Events',
    type: 'number',
    group: 'reporting',
    column: false,
    defaultVisible: true,
    help: 'How many of your events this speaker is on. Events you are not a member of are never counted.',
  },
  {
    key: 'sessionCount',
    label: 'Sessions',
    type: 'number',
    group: 'reporting',
    column: false,
    defaultVisible: true,
    help: 'Sessions in those same events. Somebody cast twice on one session counts once.',
  },
]

/** The catalog the directory's Columns, Sort and Filter panes are built from. */
export const SPEAKER_CRM_FIELDS: readonly RegistryField[] = [
  CRM_ONLY_FIELDS[0],
  ...CRM_PARTICIPANT_FIELDS,
  ...CRM_ONLY_FIELDS.slice(1),
]

/** The directory's out-of-the-box column set, in the order it renders. */
export const SPEAKER_CRM_DEFAULT_COLUMN_KEYS: readonly string[] = SPEAKER_CRM_FIELDS.filter(
  (field) => field.defaultVisible,
).map((field) => field.key)

/**
 * What the directory hands the DataTable primitive: its Columns picker, its Sort and
 * Filter panes, and its header tooltips.
 *
 * `queryableFields` is nearly the whole catalog, where the submission catalog offers only
 * `column: true` fields. The difference is where the query runs. Abstracts sorts and
 * filters through Airtable, which cannot look inside a JSON blob, so offering a non-column
 * field there would be a control that does nothing. The CRM runs its query in memory over
 * the row model, so a derived count is exactly as queryable as a stored column. The
 * headshot is the one exclusion: a condition on an image URL is not one anybody means.
 */
export const SPEAKER_CRM_CATALOG: DataTableCatalog = {
  fields: SPEAKER_CRM_FIELDS,
  queryableFields: SPEAKER_CRM_FIELDS.filter((field) => field.key !== 'headshot'),
  defaultColumnKeys: SPEAKER_CRM_DEFAULT_COLUMN_KEYS,
}
