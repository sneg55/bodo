// The write direction: app input to an Airtable field set.
//
// Mirrors mapping.ts, and has the same reason to exist. A link field must be sent
// as an ARRAY of record ids even when it holds one link, and sending the bare id
// is accepted-looking right up to the 422. Clearing a link needs `[]`, clearing a
// date needs `null`, and omitting the key leaves the old value in place, which is
// the difference between unscheduling a session and silently leaving it scheduled.

import type {
  ContentStatus,
  ParticipantRole,
  ScheduleStatus,
  SpeakerStatus,
  SubmissionSource,
  SubmissionStatus,
} from '@/constants/status'
import type { FieldSet } from '@/services/airtable/records'
import { COL } from '@/services/airtable/tables'
import type { RecordId, SpeakerLinks } from '@/types/domain'

/**
 * Drops keys whose value is `undefined`, which reads as "leave this column alone".
 * `null` survives, because that is how a column is actively cleared.
 */
export function compact(fields: Record<string, unknown>): FieldSet {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
}

/** One link id as Airtable wants it, or `[]` to clear the link. */
export function link(id: string | undefined): readonly string[] {
  return id === undefined ? [] : [id]
}

/**
 * An empty string is a REQUEST TO CLEAR, and Airtable only accepts `null` for that.
 *
 * A `<form>` posts every one of its inputs, so an optional field the speaker left
 * blank arrives as `''` and not as an absence. On a text column Airtable takes that
 * as "make it empty" and it works. On a **single select** it takes it as a request to
 * create a new choice literally named empty string, and a token without
 * `schema.bases:write` cannot, so the API answers:
 *
 *     422 INVALID_MULTIPLE_CHOICE_OPTIONS
 *     Insufficient permissions to create new select option ""
 *
 * The 422 rejects the WHOLE record, so one untouched dropdown loses the bio, the
 * headshot and every link that was posted with it. That is what made saving a speaker
 * profile fail outright, including a save that changed nothing.
 *
 * Applied to every string column rather than only the selects: `null` clears a text
 * column just as well as `''` does, the contract is then one rule instead of a list
 * that has to be kept in sync with the base's field types, and a column that becomes a
 * select later does not silently reintroduce the bug.
 */
export function blank<T>(value: T | undefined): T | null | undefined {
  if (value === undefined) return undefined
  return typeof value === 'string' && value.trim() === '' ? null : value
}

export type SubmissionDraft = {
  eventId: RecordId
  formId?: RecordId
  submitterId: RecordId
  title: string
  status: SubmissionStatus
  source: SubmissionSource
  /** Stamped here at creation and never re-derived from the form. Section 5.1b. */
  reviewRequired: boolean
  answers: Record<string, unknown>
  format?: string
  level?: string
  language?: string
  ceuCredits?: number
  trackId?: RecordId
  tagIds?: readonly RecordId[]
  submittedAt?: string
  capacity?: number
  location?: string
  clientSessionId?: string
}

export function submissionDraftFields(draft: SubmissionDraft): FieldSet {
  return compact({
    [COL.event]: link(draft.eventId),
    [COL.form]: link(draft.formId),
    [COL.submitter]: link(draft.submitterId),
    [COL.title]: draft.title,
    [COL.status]: draft.status,
    [COL.source]: draft.source,
    [COL.reviewRequired]: draft.reviewRequired,
    [COL.answersJson]: JSON.stringify(draft.answers),
    // Selects, same hazard as the speaker profile: a wizard question left blank posts
    // `''`, which Airtable reads as a new choice named empty string. See `blank()`.
    [COL.format]: blank(draft.format),
    [COL.level]: blank(draft.level),
    [COL.language]: blank(draft.language),
    [COL.ceuCredits]: draft.ceuCredits,
    [COL.track]: draft.trackId === undefined ? undefined : link(draft.trackId),
    [COL.tags]: draft.tagIds,
    [COL.submittedAt]: draft.submittedAt,
    [COL.capacity]: draft.capacity,
    [COL.location]: draft.location,
    [COL.clientSessionId]: draft.clientSessionId,
  })
}

/**
 * An edit to an existing submission: the title, the typed columns, and the whole
 * `answersJson` blob in one write.
 *
 * It takes the answers ALREADY SPLIT into columns and extras, and does not split them
 * itself. `splitAnswers` in `@/features/forms/answer-storage` owns that decision, from
 * `FormField.registryKey` and nothing else, and a second implementation here would
 * eventually disagree with it: a local dropdown an organizer named "Format" is
 * structurally identical to the registry's Format field, so guessing writes one
 * question's answer into another's column.
 *
 * `answers` REPLACES the blob rather than merging into it, so the caller must pass the
 * complete answer set. Merging would make a cleared question impossible to clear.
 * The typed columns are the other way round: an absent one is left alone, matching
 * `splitAnswers`, which omits a field that was never answered so an untouched
 * optional question cannot overwrite a column with nothing.
 */
export type SubmissionEdit = {
  title: string
  answers: Record<string, unknown>
  format?: string
  level?: string
  language?: string
  ceuCredits?: number
  trackId?: RecordId
  tagIds?: readonly RecordId[]
}

export function submissionEditFields(edit: SubmissionEdit): FieldSet {
  return compact({
    [COL.title]: edit.title,
    [COL.answersJson]: JSON.stringify(edit.answers),
    [COL.format]: blank(edit.format),
    [COL.level]: blank(edit.level),
    [COL.language]: blank(edit.language),
    [COL.ceuCredits]: edit.ceuCredits,
    [COL.track]: edit.trackId === undefined ? undefined : link(edit.trackId),
    [COL.tags]: edit.tagIds,
  })
}

export type StatusUpdate = {
  status: SubmissionStatus
  /** Stamped by the Notify step, which is also what enqueues the email. Section 3. */
  notifiedAt?: string
  /** The instant to record as the submit time, if this transition is the first one. */
  submittedAt?: string
  /** What the row already holds. `undefined` means the column is still empty. */
  currentSubmittedAt?: string
}

/**
 * A status change, plus `submittedAt` on the way into `pending` and only then.
 *
 * Two rules, both of which were bugs before this function existed. A submission moving
 * out of draft has to record WHEN, or the Abstracts table's Submitted column stays
 * empty forever and nobody can tell a submission filed on the deadline from one filed
 * a month early. And a row that already carries a submit time keeps it: `pending` is
 * re-entered when an organizer pulls a row back out of a decision queue, and
 * overwriting then would restamp a month-old submission with today's date.
 */
export function statusFields(update: StatusUpdate): FieldSet {
  const firstSubmit = update.status === 'pending' && update.currentSubmittedAt === undefined
  return compact({
    [COL.status]: update.status,
    [COL.notifiedAt]: update.notifiedAt,
    [COL.submittedAt]: firstSubmit ? update.submittedAt : undefined,
  })
}

export type ParticipantDraft = {
  speakerId: RecordId
  role: ParticipantRole
  isPrimary: boolean
  sortOrder: number
}

export function participantFields(draft: ParticipantDraft, submissionId: RecordId): FieldSet {
  return compact({
    [COL.submission]: link(submissionId),
    [COL.speaker]: link(draft.speakerId),
    [COL.role]: draft.role,
    [COL.isPrimary]: draft.isPrimary,
    [COL.sortOrder]: draft.sortOrder,
  })
}

/** The content approval column on its own. One field, so nothing else can be disturbed. */
export function contentStatusFields(status: ContentStatus): FieldSet {
  return { [COL.contentStatus]: status }
}

export type ScheduleUpdate = {
  roomId?: RecordId
  startsAt?: string
  endsAt?: string
  scheduleStatus: ScheduleStatus
}

/**
 * Scheduling is the one update that has to clear as well as set: dragging a
 * session back to the unscheduled tray must empty the room and the times, so
 * these keys are always present and carry `[]` or `null` when there is no value.
 */
export function scheduleFields(update: ScheduleUpdate): FieldSet {
  return {
    [COL.room]: link(update.roomId),
    [COL.startsAt]: update.startsAt ?? null,
    [COL.endsAt]: update.endsAt ?? null,
    [COL.scheduleStatus]: update.scheduleStatus,
  }
}

export type SpeakerDraft = {
  email: string
  firstName?: string
  lastName?: string
  salutation?: string
  honorific?: string
  pronouns?: string
  gender?: string
  phone?: string
  bio?: string
  tagline?: string
  company?: string
  headshotUrl?: string
  /** Where the person is in the organizer's process. See SPEAKER_STATUSES. */
  status?: SpeakerStatus
  dietary?: string
  travelNotes?: string
  links?: SpeakerLinks
  eventIds?: readonly RecordId[]
}

export function speakerFields(draft: SpeakerDraft): FieldSet {
  return compact({
    // Not `blank()`: the email is the identity every other row links on, and clearing
    // it is never what a blank input meant.
    [COL.email]: draft.email,
    [COL.firstName]: blank(draft.firstName),
    [COL.lastName]: blank(draft.lastName),
    // The four selects, and the reason `blank()` exists. See its comment.
    [COL.salutation]: blank(draft.salutation),
    [COL.honorific]: blank(draft.honorific),
    [COL.pronouns]: blank(draft.pronouns),
    [COL.gender]: blank(draft.gender),
    [COL.phone]: blank(draft.phone),
    [COL.bio]: blank(draft.bio),
    [COL.tagline]: blank(draft.tagline),
    [COL.company]: blank(draft.company),
    [COL.headshotUrl]: blank(draft.headshotUrl),
    [COL.status]: blank(draft.status),
    [COL.dietary]: blank(draft.dietary),
    [COL.travelNotes]: blank(draft.travelNotes),
    [COL.linksJson]: draft.links === undefined ? undefined : JSON.stringify(draft.links),
    [COL.events]: draft.eventIds,
  })
}
