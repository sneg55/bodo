// Remote status to bodo status, one explicit table per source. BUILD_SPEC 5.0e.
//
// Sessionboard's enum is the identity on all five of its values and bodo has two more
// (`draft`, `withdrawn`). Writing it as `status as SubmissionStatus` would work today and
// keep working right up until they add a sixth value or rename one, at which point every
// imported session lands with a status no filter matches and no error is raised anywhere.
// An identity mapping that quietly stops being one is invisible, so it is a table with a
// test, and unrecognised values fall back loudly rather than passing through.

import type { SubmissionStatus } from '@/constants/status'

export const SESSIONBOARD_STATUSES = [
  'accepted',
  'accept_queue',
  'pending',
  'decline_queue',
  'declined',
] as const
export type SessionboardStatus = (typeof SESSIONBOARD_STATUSES)[number]

export const SESSIONBOARD_STATUS_MAP: Record<SessionboardStatus, SubmissionStatus> = {
  accepted: 'accepted',
  accept_queue: 'accept_queue',
  pending: 'pending',
  decline_queue: 'decline_queue',
  declined: 'declined',
}

/**
 * Where an unknown value lands. `pending` and not `draft`: a draft is speaker-editable
 * and invisible to review, so an unmapped remote status would arrive as content the
 * organizer never sees. Pending puts it in front of them.
 */
export const SESSIONBOARD_STATUS_FALLBACK: SubmissionStatus = 'pending'

export type MappedStatus = {
  status: SubmissionStatus
  /** False when the fallback was used, so the preview can name the value it did not know. */
  recognized: boolean
}

export function isSessionboardStatus(value: string): value is SessionboardStatus {
  return (SESSIONBOARD_STATUSES as readonly string[]).includes(value)
}

/** Derived from the table above, never edited: a Map rather than indexing the record
 * with a runtime string, which is an object-injection sink the linter rejects. */
const SESSIONBOARD_LOOKUP: ReadonlyMap<string, SubmissionStatus> = new Map(
  Object.entries(SESSIONBOARD_STATUS_MAP),
)

export function mapSessionboardStatus(raw: string | null | undefined): MappedStatus {
  const status = SESSIONBOARD_LOOKUP.get((raw ?? '').trim().toLowerCase())
  return status === undefined
    ? { status: SESSIONBOARD_STATUS_FALLBACK, recognized: false }
    : { status, recognized: true }
}

/**
 * Sessionize has no status enum to map, it has an absence of one.
 *
 * TRAP 2: only accepted sessions are exposed at all. Drafts and rejects never leave
 * their side, so a Sessionize import can only produce accepted submissions and can never
 * seed a review queue. Anything here that returned `pending` would create a review
 * backlog out of decisions the organizer already made.
 *
 * TRAP 3: service sessions (the demo event's `Lunch`) carry `status: null` and
 * `isServiceSession: true`. They are agenda furniture with no speaker, so they are not
 * submissions at any status. A discriminated result rather than a nullable one, because
 * `undefined` at a call site reads as "unknown status" and gets defaulted.
 */
export type SessionizeStatusResult =
  | { kind: 'submission'; status: SubmissionStatus }
  | { kind: 'agenda_only'; reason: 'service_session' }

export const SESSIONIZE_IMPORTED_STATUS: SubmissionStatus = 'accepted'

export function mapSessionizeStatus(session: {
  isServiceSession?: boolean | null
  status?: string | null
}): SessionizeStatusResult {
  // `isServiceSession` is decisive and `status` is not consulted. A null status on a
  // non-service session would still be an accepted session, because that is the only
  // kind the endpoint returns; treating null as furniture would drop real programme.
  if (session.isServiceSession === true) {
    return { kind: 'agenda_only', reason: 'service_session' }
  }
  return { kind: 'submission', status: SESSIONIZE_IMPORTED_STATUS }
}

/**
 * Accelevents publishes a programme, not a review pipeline: their session list carries
 * no state bodo's review lifecycle consumes, so everything imported from there is
 * already a decision the organizer made on the far side.
 *
 * The function exists rather than the constant being inlined so that a status field
 * appearing on their side later has exactly one place to be handled, and so the test
 * below pins the current behaviour instead of it being an implicit literal in normalize.
 */
export const ACCELEVENTS_IMPORTED_STATUS: SubmissionStatus = 'accepted'

export function mapAcceleventsStatus(): SubmissionStatus {
  return ACCELEVENTS_IMPORTED_STATUS
}
