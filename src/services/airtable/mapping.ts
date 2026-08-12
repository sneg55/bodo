// Airtable records to app types: events, speakers, submissions, participants.
//
// This is where silent data corruption would live, so it is the most heavily
// tested module in the directory (tests/airtable-mapping.test.ts). Three specific
// traps it exists to absorb:
//
//   - A link field is always an array of record ids on the wire. A single link
//     becomes a scalar id here, because `submission.trackId` reading as
//     `['recX']` would compare unequal to every track id in the app.
//   - `code` is an autonumber, so it arrives as a number. The app and the portal
//     both show `SESS-<n>`, and formatting it at each render site is how two
//     screens end up disagreeing about a speaker's own reference number.
//   - An empty Airtable field is an absent key, not a null, so every optional
//     read has to treat missing and blank identically.

import {
  CONTENT_STATUSES,
  PARTICIPANT_ROLES,
  SCHEDULE_STATUSES,
  SPEAKER_STATUSES,
  SUBMISSION_SOURCES,
  SUBMISSION_STATUSES,
} from '@/constants/status'
import {
  type AirtableRecord,
  checkbox,
  choiceOr,
  jsonBlob,
  linkIds,
  numberOr,
  optionalChoice,
  optionalLink,
  optionalNumber,
  optionalText,
  type RecordView,
  requiredChoice,
  requiredLink,
  shapeError,
  text,
  view,
} from '@/services/airtable/records'
import { answersSchema, speakerLinksSchema } from '@/services/airtable/schemas'
import { CODE_PREFIX, COL, TABLES } from '@/services/airtable/tables'
import type {
  Event,
  Speaker,
  SpeakerLinks,
  Submission,
  SubmissionParticipant,
} from '@/types/domain'

export function mapEvent(record: AirtableRecord): Event {
  const source = view(TABLES.events, record)
  return {
    id: source.id,
    name: text(source, COL.name),
    slug: text(source, COL.slug),
    eventType: optionalText(source, COL.eventType) ?? 'Conference',
    websiteUrl: optionalText(source, COL.websiteUrl),
    location: optionalText(source, COL.location),
    startsAt: optionalText(source, COL.startsAt),
    endsAt: optionalText(source, COL.endsAt),
    // A timezone is load-bearing for every .ics and every agenda slot, so a blank
    // one is a guess either way. UTC is the guess that is obvious when it is wrong.
    timezone: optionalText(source, COL.timezone) ?? 'UTC',
    theme: optionalText(source, COL.theme),
    logoUrl: optionalText(source, COL.logoUrl),
    backgroundUrl: optionalText(source, COL.backgroundUrl),
    cfpDeadline: optionalText(source, COL.cfpDeadline),
    submissionLimitPerUser: optionalNumber(source, COL.submissionLimitPerUser),
    status: choiceOr(source, COL.status, ['draft', 'open', 'closed'] as const, 'draft'),
    accelEventUrl: optionalText(source, COL.accelEventUrl),
    accelEventId: optionalText(source, COL.accelEventId),
    accelSyncEnabled: checkbox(source, COL.accelSyncEnabled),
  }
}

function mapSpeakerLinks(source: RecordView): SpeakerLinks {
  // Two column names, one concept: see the note on COL.linksJson.
  const primary = jsonBlob(source, COL.linksJson, speakerLinksSchema, {})
  if (Object.keys(primary).length > 0) return primary
  return jsonBlob(source, COL.links, speakerLinksSchema, {})
}

export function mapSpeaker(record: AirtableRecord): Speaker {
  const source = view(TABLES.speakers, record)
  return {
    id: source.id,
    email: text(source, COL.email),
    salutation: optionalText(source, COL.salutation),
    firstName: optionalText(source, COL.firstName) ?? '',
    lastName: optionalText(source, COL.lastName) ?? '',
    honorific: optionalText(source, COL.honorific),
    pronouns: optionalText(source, COL.pronouns),
    gender: optionalText(source, COL.gender),
    phone: optionalText(source, COL.phone),
    bio: optionalText(source, COL.bio),
    tagline: optionalText(source, COL.tagline),
    company: optionalText(source, COL.company),
    headshotUrl: optionalText(source, COL.headshotUrl),
    // `optionalChoice`, not `optionalText`: an unrecognised value in the column reads as
    // absent rather than becoming a status no surface can render or filter on.
    status: optionalChoice(source, COL.status, SPEAKER_STATUSES),
    dietary: optionalText(source, COL.dietary),
    travelNotes: optionalText(source, COL.travelNotes),
    invitedAt: optionalText(source, COL.invitedAt),
    links: mapSpeakerLinks(source),
  }
}

/** Which events a speaker is on. Needed to scope a speaker list to one event. */
export function speakerEventIds(record: AirtableRecord): readonly string[] {
  return linkIds(view(TABLES.speakers, record), COL.events)
}

/**
 * `code` is an autonumber, so Airtable sends a bare number. It is rendered once,
 * here, because the portal and the admin tables both quote it back to a speaker.
 */
function mapCode(source: RecordView): string {
  const raw = source.get(COL.code)
  if (typeof raw === 'number' && Number.isFinite(raw)) return `${CODE_PREFIX}${raw}`
  if (typeof raw === 'string' && raw !== '') {
    return raw.startsWith(CODE_PREFIX) ? raw : `${CODE_PREFIX}${raw}`
  }
  throw shapeError(source, COL.code, 'is required but empty')
}

export function mapSubmission(record: AirtableRecord): Submission {
  const source = view(TABLES.submissions, record)
  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    formId: optionalLink(source, COL.form),
    submitterId: requiredLink(source, COL.submitter),
    code: mapCode(source),
    title: text(source, COL.title),
    status: requiredChoice(source, COL.status, SUBMISSION_STATUSES),
    source: choiceOr(source, COL.source, SUBMISSION_SOURCES, 'form'),
    reviewRequired: checkbox(source, COL.reviewRequired),
    answers: jsonBlob(source, COL.answersJson, answersSchema, {}),
    format: optionalText(source, COL.format),
    level: optionalText(source, COL.level),
    language: optionalText(source, COL.language),
    ceuCredits: optionalNumber(source, COL.ceuCredits),
    trackId: optionalLink(source, COL.track),
    tagIds: linkIds(source, COL.tags),
    submittedAt: optionalText(source, COL.submittedAt),
    notifiedAt: optionalText(source, COL.notifiedAt),
    roomId: optionalLink(source, COL.room),
    startsAt: optionalText(source, COL.startsAt),
    endsAt: optionalText(source, COL.endsAt),
    scheduleStatus: choiceOr(source, COL.scheduleStatus, SCHEDULE_STATUSES, 'unscheduled'),
    // `not_submitted` for every row that predates the column, which is what those rows
    // genuinely mean: nobody has reviewed content that was never uploaded.
    contentStatus: choiceOr(source, COL.contentStatus, CONTENT_STATUSES, 'not_submitted'),
    capacity: optionalNumber(source, COL.capacity),
    location: optionalText(source, COL.location),
    clientSessionId: optionalText(source, COL.clientSessionId),
    calendarUid: optionalText(source, COL.calendarUid),
    calendarSequence: numberOr(source, COL.calendarSequence, 0),
    calendarDtstamp: optionalText(source, COL.calendarDtstamp),
    calendarStatus: choiceOr(
      source,
      COL.calendarStatus,
      ['active', 'cancelled'] as const,
      'active',
    ),
  }
}

export function mapParticipant(record: AirtableRecord): SubmissionParticipant {
  const source = view(TABLES.submissionParticipants, record)
  return {
    id: source.id,
    submissionId: requiredLink(source, COL.submission),
    speakerId: requiredLink(source, COL.speaker),
    // A blank role is a solo presenter as far as every consumer is concerned, and
    // the agenda's overlap check needs the row either way.
    role: optionalChoice(source, COL.role, PARTICIPANT_ROLES) ?? 'speaker',
    isPrimary: checkbox(source, COL.isPrimary),
    sortOrder: numberOr(source, COL.sortOrder, 0),
  }
}
