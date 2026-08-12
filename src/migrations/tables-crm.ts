// The four tables the cross-event CRM adds: SpeakerTags, SpeakerLists, SpeakerNotes and
// SpeakerStageHistory.
//
// All four are new rather than extensions of existing tables, and that is the point.
// `Tags` is event-scoped (listByEvent in reads-review.ts) and describes session tracks;
// `SavedViews` requires an eventId and its `surface` is a select whose options must match
// SAVED_VIEW_SURFACES exactly. Changing either would alter a required field or a select
// option, and README.md in this directory records that nothing here has ever run against
// a real base, so an additive table is the only change that can fail loudly.
//
// Each declaration leads with a text field because Airtable forbids a link, select, or
// checkbox as the primary field.

import {
  checkboxField,
  dateTimeField,
  link,
  longText,
  type TableSpec,
  text,
} from '@/migrations/schema-types'
import { COL, TABLES } from '@/services/airtable/tables'

const speakerTags: TableSpec = {
  name: TABLES.speakerTags,
  fields: [text(COL.name), text(COL.color), link(COL.speakers, TABLES.speakers)],
}

const speakerLists: TableSpec = {
  name: TABLES.speakerLists,
  fields: [
    text(COL.name),
    // A DataTableFilter[] as JSON. Stored rather than modelled as rows because the shape
    // is the DataTable's own and a parallel table would need converting at every boundary.
    longText(COL.definitionJson),
    checkboxField(COL.isShared),
    link(COL.owner, TABLES.adminUsers),
  ],
}

/**
 * An organizer's internal note about a CONTACT, not about an event.
 *
 * Append only, the same rule ContentRevisions and FileComments follow and for the same
 * reason: a note an organizer can quietly rewrite is not a record of what was decided.
 * "Said no for 2026, ask again in spring" is worth having in March precisely because it
 * still says that in March.
 *
 * There is deliberately NO event link. A note follows the person across every conference
 * they are in scope for, which is what makes it different from `Speakers.travelNotes`: that
 * column is one organizer's logistics for one trip and lives on the Speakers row.
 *
 * `authorName` is SNAPSHOTTED rather than linked, the call both other log tables make: the
 * name beside a note is who wrote it at the time, and an organizer removed from the event
 * later must not turn their past notes anonymous.
 */
const speakerNotes: TableSpec = {
  // `authorName` leads because the primary field has to be a legal one and the table's other
  // text column is the note body, which is multiline. See the header.
  name: TABLES.speakerNotes,
  fields: [
    text(COL.authorName),
    dateTimeField(COL.at),
    link(COL.speaker, TABLES.speakers),
    longText(COL.body),
  ],
}

/**
 * One move of a contact through the sourcing pipeline: who moved them, when, from what, to
 * what.
 *
 * `previousValue` and `newValue` rather than `fromStatus`/`toStatus`, because those two
 * names already exist in `COL` and mean exactly this on ContentRevisions. One name for one
 * concept is the registry's rule (tables.ts), and a second spelling of "the value before"
 * is how two histories end up rendering differently.
 *
 * `text` and not `select`, deliberately, even though the values come from
 * `SPEAKER_STATUSES`: a history row records what the vocabulary WAS at the time, and a
 * select would refuse to read back a status that has since been retired from the list.
 *
 * No event link, for the reason the header of table-names.ts gives: `Speakers.status` is one
 * column on the person's row, so a per-event history would be describing a per-event status
 * that does not exist.
 */
const speakerStageHistory: TableSpec = {
  name: TABLES.speakerStageHistory,
  fields: [
    text(COL.authorName),
    dateTimeField(COL.at),
    link(COL.speaker, TABLES.speakers),
    text(COL.previousValue),
    text(COL.newValue),
  ],
}

export const CRM_TABLES: readonly TableSpec[] = [
  speakerTags,
  speakerLists,
  speakerNotes,
  speakerStageHistory,
]
