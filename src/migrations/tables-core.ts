// Events, Forms, Submissions, SubmissionParticipants, Speakers.
//
// Transcribed from BUILD_SPEC section 3. Column names come from COL and never from
// a literal here: the mappers read through that registry, so a name spelled twice
// is a column the DAL reads as permanently empty rather than an error.
//
// The first field of each table is its primary field, which Airtable will not let
// be a link, a select, or a checkbox. Where section 3's column list opens with one
// of those, the declaration leads with the first column that is a legal primary
// type instead of inventing a surrogate id: `SubmissionParticipants` therefore
// leads with `sortOrder`. Reordering is free, an extra column is not.

import {
  CONTENT_STATUSES,
  FORM_ENTITY_KINDS,
  PARTICIPANT_ROLES,
  SCHEDULE_STATUSES,
  SPEAKER_STATUSES,
  SUBMISSION_SOURCES,
  SUBMISSION_STATUSES,
  TASK_ENTITY_TYPES,
} from '@/constants/status'
import {
  choiceValues,
  EVENT_TYPES,
  GENDERS,
  PRONOUNS,
  SESSION_FORMATS,
  SESSION_LANGUAGES,
  SESSION_LEVELS,
} from '@/constants/vocabularies'
import {
  autoNumber,
  checkboxField,
  dateTimeField,
  emailField,
  link,
  longText,
  numberField,
  phoneField,
  select,
  type TableSpec,
  text,
  urlField,
} from '@/migrations/schema-types'
import { COL, TABLES } from '@/services/airtable/tables'

// Vocabularies that exist only on one table, so they are not in
// src/constants/status.ts. The DAL reads each of these through `optionalText` or a
// `choiceOr` with a fallback, so the lists below are the base's opinion rather than
// a contract: see the ambiguity notes in 001-initial-schema.ts.
//
// The six a FORM also offers as options are NOT spelled here. They come from
// src/constants/vocabularies.ts, because they were spelled in two places, the two
// disagreed about capitalisation, and writing an undeclared single-select choice is a
// 422 that rejects the whole record rather than the one field. See that file's header.
const EVENT_STATUSES = ['draft', 'open', 'closed']
const FORM_KINDS = ['cfp', 'task']
const FORM_STATUSES = ['draft', 'published']
const CALENDAR_STATUSES = ['active', 'cancelled']

const events: TableSpec = {
  name: TABLES.events,
  fields: [
    text(COL.name),
    text(COL.slug),
    select(COL.eventType, choiceValues(EVENT_TYPES)),
    urlField(COL.websiteUrl),
    text(COL.location),
    // Section 3 says "dates (start/end date)" and this is dateTime rather than
    // date, deliberately. MonthView and the timeline resolve the event's first day
    // with `dateKeyAt(startsAt, timezone)`, and a date-only value arrives as UTC
    // midnight, which lands on the previous day for every timezone west of UTC.
    dateTimeField(COL.startsAt),
    dateTimeField(COL.endsAt),
    text(COL.timezone),
    longText(COL.theme),
    urlField(COL.logoUrl),
    urlField(COL.backgroundUrl),
    dateTimeField(COL.cfpDeadline),
    numberField(COL.submissionLimitPerUser),
    select(COL.status, EVENT_STATUSES),
    text(COL.accelEventUrl),
    // Read by mapEvent and absent from section 3's Events list. See the ambiguity
    // note in 001-initial-schema.ts: the mapper wins, because a column the DAL
    // reads and the base lacks is a field that is silently always undefined.
    text(COL.accelEventId),
    checkboxField(COL.accelSyncEnabled),
  ],
}

const forms: TableSpec = {
  name: TABLES.forms,
  fields: [
    text(COL.name),
    link(COL.event, TABLES.events),
    text(COL.publicId),
    select(COL.kind, FORM_KINDS),
    select(COL.entityKind, FORM_ENTITY_KINDS),
    checkboxField(COL.participantsEnabled),
    select(COL.status, FORM_STATUSES),
    longText(COL.welcomeHtml),
    longText(COL.successHtml),
    longText(COL.fieldsJson),
    longText(COL.participantFieldsJson),
    longText(COL.routingJson),
    longText(COL.rolesJson),
    longText(COL.crossFieldLimitsJson),
    dateTimeField(COL.closeDate),
    numberField(COL.submissionLimit),
    checkboxField(COL.allowMultipleDrafts),
    checkboxField(COL.autoRedirectToPortal),
    // Portal forms only. Same three values as a Task's entityType, so it reuses the
    // registered vocabulary rather than restating it.
    select(COL.entityType, TASK_ENTITY_TYPES),
    checkboxField(COL.confirmationEmailEnabled),
    longText(COL.confirmationEmailHtml),
    // Recipient lists, not one address: `emailList` in records.ts splits on commas,
    // semicolons and newlines, so this is text and not an email column.
    text(COL.adminAlertOnNew),
    text(COL.adminAlertOnUpdate),
    // The participant-facing headings for steps 2, 3 and 4. Until these existed the
    // builder rendered no control for them, because a control would have stored a value
    // nothing could read back; the public wizard now renders all three sets.
    text(COL.externalTitle),
    text(COL.welcomeHeading),
    text(COL.abstractSectionTitle),
    text(COL.abstractHeading),
    longText(COL.abstractSectionHtml),
    text(COL.participantSectionTitle),
    text(COL.participantHeading),
    longText(COL.participantSectionHtml),
  ],
}

const submissions: TableSpec = {
  name: TABLES.submissions,
  fields: [
    text(COL.title),
    link(COL.event, TABLES.events),
    link(COL.form, TABLES.forms),
    link(COL.submitter, TABLES.speakers),
    autoNumber(COL.code),
    longText(COL.answersJson),
    select(COL.status, SUBMISSION_STATUSES),
    select(COL.source, SUBMISSION_SOURCES),
    checkboxField(COL.reviewRequired),
    select(COL.format, choiceValues(SESSION_FORMATS)),
    select(COL.level, choiceValues(SESSION_LEVELS)),
    select(COL.language, choiceValues(SESSION_LANGUAGES)),
    numberField(COL.ceuCredits, 1),
    link(COL.track, TABLES.tracks),
    link(COL.tags, TABLES.tags),
    dateTimeField(COL.submittedAt),
    dateTimeField(COL.notifiedAt),
    link(COL.room, TABLES.rooms),
    dateTimeField(COL.startsAt),
    dateTimeField(COL.endsAt),
    select(COL.scheduleStatus, SCHEDULE_STATUSES),
    select(COL.contentStatus, CONTENT_STATUSES),
    numberField(COL.capacity),
    text(COL.location),
    text(COL.clientSessionId),
    text(COL.calendarUid),
    numberField(COL.calendarSequence),
    dateTimeField(COL.calendarDtstamp),
    select(COL.calendarStatus, CALENDAR_STATUSES),
  ],
}

const submissionParticipants: TableSpec = {
  name: TABLES.submissionParticipants,
  fields: [
    numberField(COL.sortOrder),
    link(COL.submission, TABLES.submissions),
    link(COL.speaker, TABLES.speakers),
    select(COL.role, PARTICIPANT_ROLES),
    checkboxField(COL.isPrimary),
  ],
}

const speakers: TableSpec = {
  name: TABLES.speakers,
  fields: [
    emailField(COL.email),
    text(COL.salutation),
    text(COL.firstName),
    text(COL.lastName),
    text(COL.honorific),
    select(COL.pronouns, choiceValues(PRONOUNS)),
    select(COL.gender, choiceValues(GENDERS)),
    phoneField(COL.phone),
    longText(COL.bio),
    text(COL.tagline),
    text(COL.company),
    urlField(COL.headshotUrl),
    // Where the PERSON is in the organizer's process, which is not where their submission
    // is: an accepted talk whose speaker has not confirmed they are coming is the ordinary
    // case, and one column cannot answer both questions. See SPEAKER_STATUSES.
    select(COL.status, [...SPEAKER_STATUSES]),
    // Logistics. Free text on purpose: a dietary requirement and a travel arrangement are
    // exactly the fields no vocabulary survives, and an organizer needs to write "coeliac,
    // and no shellfish" rather than pick from a list somebody guessed at.
    text(COL.dietary),
    longText(COL.travelNotes),
    // When the organizer last sent this person a portal invitation. Written by the invite
    // action, read by the roster's Invited column and by the invite's idempotency key.
    dateTimeField(COL.invitedAt),
    // Section 3 calls this column `links` and the DAL reads `linksJson` first. The
    // migration settles on `linksJson`, as the note on COL.linksJson asks it to.
    longText(COL.linksJson),
    link(COL.events, TABLES.events),
  ],
}

export const CORE_TABLES: readonly TableSpec[] = [
  events,
  forms,
  submissions,
  submissionParticipants,
  speakers,
]
