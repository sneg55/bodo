// The lifecycle vocabularies. Every status string in the app comes from here, so
// a typo is a type error rather than a row that silently never matches a filter.
//
// The submission lifecycle is richer than the brief's text: it was read off the
// real product (docs/parity/abstracts-review.md). Accept Queue and Decline Queue
// are staging states, and a separate Notify step promotes them. See BUILD_SPEC §3.

export const SUBMISSION_STATUSES = [
  'draft',
  'pending',
  'accept_queue',
  'decline_queue',
  'accepted',
  'declined',
  'withdrawn',
] as const

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]

/** Display labels, exactly as the product renders them. Familiarity is scored. */
export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  draft: 'Draft',
  pending: 'Pending',
  accept_queue: 'Accept Queue',
  decline_queue: 'Decline Queue',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
}

/**
 * Legal transitions. The queue states exist so a decision can be staged and then
 * committed in bulk by Notify, which is also what sends the email, so a status
 * jumping straight from pending to accepted would skip the notification entirely.
 */
export const SUBMISSION_TRANSITIONS: Record<SubmissionStatus, readonly SubmissionStatus[]> = {
  draft: ['pending', 'withdrawn'],
  pending: ['accept_queue', 'decline_queue', 'withdrawn'],
  accept_queue: ['pending', 'decline_queue', 'accepted', 'withdrawn'],
  decline_queue: ['pending', 'accept_queue', 'declined', 'withdrawn'],
  // Post-decision moves are deliberate and rare, but a mistaken accept has to be
  // recoverable without editing Airtable by hand.
  accepted: ['withdrawn', 'decline_queue'],
  declined: ['pending', 'accept_queue'],
  withdrawn: ['pending'],
}

/** Statuses that mean "this is real content an organizer is committed to". */
export const ACCEPTED_STATUSES: readonly SubmissionStatus[] = ['accepted']

/** Statuses a speaker may still edit the body of. See BUILD_SPEC §5.2. */
export const SPEAKER_EDITABLE_STATUSES: readonly SubmissionStatus[] = ['draft', 'pending']

// ── Scheduling ───────────────────────────────────────────────────────────────
// Orthogonal to the review lifecycle: an accepted submission is unscheduled until
// it gets a room and a time, and published is what the public embeds expose.

export const SCHEDULE_STATUSES = ['unscheduled', 'scheduled', 'published'] as const
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number]

/**
 * Where a session's CONTENT stands, which is a different question from whether the talk was
 * accepted or whether it has been scheduled.
 *
 * An accepted talk whose slides have not been looked at, and one whose slides were reviewed
 * and sent back for changes, are the same on every other column this schema has. That is
 * what left an organizer with no way to answer "what still needs reading" except by opening
 * every deck.
 *
 * `not_submitted` is the floor rather than an absence, so the column always says something:
 * a session nobody has uploaded anything for is a fact worth stating, not a blank.
 */
export const CONTENT_STATUSES = [
  'not_submitted',
  'pending_review',
  'changes_requested',
  'approved',
] as const
export type ContentStatus = (typeof CONTENT_STATUSES)[number]

const CONTENT_STATUS_LABELS: ReadonlyMap<ContentStatus, string> = new Map([
  ['not_submitted', 'Not submitted'],
  ['pending_review', 'Pending review'],
  ['changes_requested', 'Changes requested'],
  ['approved', 'Approved'],
])

export function contentStatusLabel(status: ContentStatus): string {
  return CONTENT_STATUS_LABELS.get(status) ?? status
}

// ── Participants ─────────────────────────────────────────────────────────────

export const PARTICIPANT_ROLES = ['speaker', 'co_speaker', 'moderator', 'chairperson'] as const
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number]

export const PARTICIPANT_ROLE_LABELS: Record<ParticipantRole, string> = {
  speaker: 'Speaker',
  co_speaker: 'Co-Speaker',
  moderator: 'Moderator',
  chairperson: 'Chairperson',
}

/**
 * Defaults for a new form. One required primary speaker, everything else optional.
 *
 * This is the single most consequential default in the form builder. The organizer
 * walkthrough hit a validation wall on his own form and said "obviously I should
 * not have a minimum of two speakers, that's not something that we do". A default
 * that blocks a solo speaker fails at the exact moment a stranger is trying to
 * give you a talk. See BUILD_SPEC §5.1.
 */
export const DEFAULT_PARTICIPANT_ROLES: readonly {
  role: ParticipantRole
  enabled: boolean
  min: number
  max: number
}[] = [
  { role: 'speaker', enabled: true, min: 1, max: 1 },
  { role: 'co_speaker', enabled: true, min: 0, max: 4 },
  { role: 'moderator', enabled: false, min: 0, max: 1 },
  { role: 'chairperson', enabled: false, min: 0, max: 1 },
]

// ── Other small vocabularies ─────────────────────────────────────────────────

export const EVENT_ROLES = ['admin', 'reviewer'] as const
export type EventRole = (typeof EVENT_ROLES)[number]

export const SUBMISSION_SOURCES = ['form', 'manual'] as const
export type SubmissionSource = (typeof SUBMISSION_SOURCES)[number]

/** What a form produces. Decides whether the content goes through review at all. */
export const FORM_ENTITY_KINDS = ['abstracts', 'sessions'] as const
export type FormEntityKind = (typeof FORM_ENTITY_KINDS)[number]

export const TASK_ENTITY_TYPES = ['contact', 'group', 'submission'] as const
export type TaskEntityType = (typeof TASK_ENTITY_TYPES)[number]

export const OUTBOX_STATUSES = ['queued', 'sending', 'sent', 'failed', 'dead'] as const
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number]

/**
 * What a mail's state is called on an organizer-facing surface.
 *
 * Here rather than beside the chip that renders them, for the reason the file header
 * gives: a second copy of a vocabulary is how a status ends up rendering as a blank chip
 * that nothing matches. `dead` is the one that is not just title case: the stored value is
 * the drain's word for "attempts exhausted, nothing will retry this", and "Dead" alone
 * tells an organizer nothing about whether the speaker got the mail.
 */
export const OUTBOX_STATUS_LABELS: Record<OutboxStatus, string> = {
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
  dead: 'Not delivered',
}

export const REVIEW_RECOMMENDATIONS = ['yes', 'no', 'maybe'] as const
export type ReviewRecommendation = (typeof REVIEW_RECOMMENDATIONS)[number]

export const SUBMISSION_ROUND_STATUSES = ['pending', 'in_review', 'advanced', 'rejected'] as const
export type SubmissionRoundStatus = (typeof SUBMISSION_ROUND_STATUSES)[number]

/**
 * Where a PERSON is in the organizer's process, which is not where their submission is.
 *
 * The two are genuinely independent and conflating them is the mistake this vocabulary
 * exists to avoid: a speaker whose talk was accepted has still not confirmed they are
 * coming, and one who has confirmed may later drop out while the session stays accepted
 * until somebody withdraws it. `Submissions.status` answers "is this talk in the
 * programme"; this answers "is this person coming".
 *
 * `prospect` leads because that is what a speaker record created by a submission is: they
 * applied, nobody has invited them anywhere yet.
 */
export const SPEAKER_STATUSES = [
  'prospect',
  'invited',
  'confirmed',
  'declined',
  'cancelled',
] as const
export type SpeakerStatus = (typeof SPEAKER_STATUSES)[number]

/**
 * Display labels, exactly as the roster renders them.
 *
 * A `Map` rather than a record, matching `TEAM_ROLE_LABELS`: every call site looks this up
 * with a variable, and a computed index on a plain object is what
 * `security/detect-object-injection` refuses.
 */
export const SPEAKER_STATUS_LABELS: ReadonlyMap<SpeakerStatus, string> = new Map([
  ['prospect', 'Prospect'],
  ['invited', 'Invited'],
  ['confirmed', 'Confirmed'],
  ['declined', 'Declined'],
  ['cancelled', 'Cancelled'],
])

export function speakerStatusLabel(status: SpeakerStatus): string {
  return SPEAKER_STATUS_LABELS.get(status) ?? status
}
