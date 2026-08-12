// App input to an Airtable field set, for the portal and comms tables.
//
// Split from to-fields.ts for the line limit, and it inherits that file's whole
// reason for existing: a link is an ARRAY even when it holds one id, `null` clears a
// column, and an ABSENT key leaves the old value in place. Which of the last two a
// builder chooses is a decision per column, not a style, so each one below says which
// it made and why.

import type { FieldSet } from '@/services/airtable/records'
import { COL } from '@/services/airtable/tables'
import { compact, link } from '@/services/airtable/to-fields'
import type {
  OutboxPayload,
  OutboxRow,
  RecordId,
  StoredFile,
  Task,
  TaskAssignment,
} from '@/types/domain'

export type TaskDraft = {
  eventId: RecordId
  title: string
  description?: string
  entityType: Task['entityType']
  /**
   * Fixed at `manual` by every caller that exists, and still a parameter rather than a
   * literal here: ref 25 renders it as the `Manual` chip, and BUILD_SPEC 5.6's
   * accept-time fan-out is the `automated` side of the same column.
   */
  origin: Task['origin']
  kind: Task['kind']
  formId?: RecordId
  dueAt?: string
  appliesTo?: 'all_accepted'
}

/**
 * A Tasks row, as an organizer defines it.
 *
 * `compact` throughout, so an absent description, form link, due date or appliesTo is
 * simply not sent. That is the right direction for a CREATE: there is no previous value to
 * leave in place, and sending `null` into an Airtable select column that has never held a
 * value is a 422 rather than a blank.
 */
export function taskFields(draft: TaskDraft): FieldSet {
  return compact({
    [COL.title]: draft.title,
    [COL.event]: link(draft.eventId),
    [COL.description]: draft.description,
    [COL.entityType]: draft.entityType,
    [COL.origin]: draft.origin,
    [COL.kind]: draft.kind,
    [COL.form]: draft.formId === undefined ? undefined : link(draft.formId),
    [COL.dueAt]: draft.dueAt,
    [COL.appliesTo]: draft.appliesTo,
  })
}

export type TaskAssignmentDraft = {
  taskId: RecordId
  speakerId: RecordId
  /** Set only for a submission-scoped task. See `planAssignments`. */
  submissionId?: RecordId
}

/**
 * One assignment, created pending.
 *
 * `status` is written explicitly rather than left to the column's default, because
 * `mapTaskAssignment` reads a blank one as `pending` and a row that RELIES on that would
 * be indistinguishable from a row whose status somebody cleared by hand. `completedAt` is
 * absent, not `null`: nothing has happened yet, and there is no stale stamp to clear.
 */
export function taskAssignmentFields(draft: TaskAssignmentDraft): FieldSet {
  return compact({
    [COL.task]: link(draft.taskId),
    [COL.speaker]: link(draft.speakerId),
    [COL.submission]: draft.submissionId === undefined ? undefined : link(draft.submissionId),
    [COL.status]: 'pending',
  })
}

export type TaskAssignmentUpdate = {
  status: TaskAssignment['status']
  /** The instant the speaker finished it. Absent reopens the task. */
  completedAt?: string
  /** `kind: 'form'` evidence. Absent leaves the stored answers alone. */
  answers?: Record<string, unknown>
}

/**
 * Mark an assignment done, or put it back to pending.
 *
 * `completedAt` is always present in the write and carries `null` when there is none,
 * because reopening a task has to clear the stamp: an omitted key would leave a
 * pending row still claiming it was completed on Tuesday, and the admin's progress
 * count would read one thing while the portal read another.
 *
 * `answersJson` is the opposite. It is omitted when there are no answers, because a
 * `link` or `confirm` task has none and writing `null` there would wipe the evidence
 * a form task had already saved.
 */
export function taskAssignmentUpdateFields(update: TaskAssignmentUpdate): FieldSet {
  const fields: Record<string, unknown> = {
    [COL.status]: update.status,
    [COL.completedAt]: update.completedAt ?? null,
  }
  if (update.answers !== undefined) {
    fields[COL.answersJson] = JSON.stringify(update.answers)
  }
  return fields
}

/** Autosave for a form task: the answers and nothing else. */
export function taskAnswersFields(answers: Record<string, unknown>): FieldSet {
  return { [COL.answersJson]: JSON.stringify(answers) }
}

export type FileDraft = Omit<StoredFile, 'id'>

/**
 * A Files row, written only once the object is stored and HEADed (section 5.2).
 *
 * There is no url column to build, and that is the schema's decision rather than an
 * omission here: `objectKey` is the durable identifier, a public link is derived from
 * `R2_PUBLIC_BASE_URL` at read time, and a private one is served through an
 * authenticated route. Baking a URL into the row would freeze both the bucket domain
 * and the access model.
 */
export function fileFields(draft: FileDraft): FieldSet {
  return compact({
    [COL.speaker]: link(draft.speakerId),
    [COL.submission]: draft.submissionId === undefined ? undefined : link(draft.submissionId),
    [COL.fileRequestAssignment]:
      draft.fileRequestAssignmentId === undefined ? undefined : link(draft.fileRequestAssignmentId),
    [COL.kind]: draft.kind,
    [COL.objectKey]: draft.objectKey,
    [COL.visibility]: draft.visibility,
    [COL.contentType]: draft.contentType,
    [COL.filename]: draft.filename,
    [COL.size]: draft.size,
    [COL.uploadedAt]: draft.uploadedAt,
    // Set only after the server confirmed the stored size and type, so a row never
    // claims bytes that were not stored. Section 5.2.
    [COL.verifiedAt]: draft.verifiedAt,
  })
}

export type OutboxDraft = {
  eventId: RecordId
  templateId?: RecordId
  templateSource: OutboxRow['templateSource']
  formId?: RecordId
  speakerId?: RecordId
  submissionId?: RecordId
  taskId?: RecordId
  /** Deterministic, e.g. `accepted:<submissionId>:<notifiedAt>`. Section 5.3. */
  idempotencyKey: string
  payload: OutboxPayload
  toEmail: string
  sendAt: string
}

/**
 * One queued message.
 *
 * `payloadJson` is the rendered subject and body as they read at enqueue time, not a
 * reference to the template: a template edited between queueing and sending must not
 * change mail that was already promised, and a failed row stays inspectable without
 * re-rendering it.
 *
 * `status` and `attempts` are part of the CREATE shape because a fresh row is queued
 * with no attempts behind it. That is also why `enqueueEmails` never sends this field
 * set at an existing key: it would reset a row that has already been sent.
 */
export function outboxFields(draft: OutboxDraft): FieldSet {
  return compact({
    [COL.event]: link(draft.eventId),
    [COL.template]: draft.templateId === undefined ? undefined : link(draft.templateId),
    [COL.templateSource]: draft.templateSource,
    [COL.form]: draft.formId === undefined ? undefined : link(draft.formId),
    [COL.speaker]: draft.speakerId === undefined ? undefined : link(draft.speakerId),
    [COL.submission]: draft.submissionId === undefined ? undefined : link(draft.submissionId),
    [COL.task]: draft.taskId === undefined ? undefined : link(draft.taskId),
    [COL.idempotencyKey]: draft.idempotencyKey,
    [COL.payloadJson]: JSON.stringify(draft.payload),
    [COL.toEmail]: draft.toEmail,
    [COL.sendAt]: draft.sendAt,
    [COL.status]: 'queued',
    [COL.attempts]: 0,
  })
}

export type OutboxOutcome = {
  status: OutboxRow['status']
  attempts: number
  /** Held while a send is in flight. Absent releases it. */
  leaseHolder?: string
  leaseExpiresAt?: string
  providerMessageId?: string
  lastError?: string
  sentAt?: string
}

/**
 * The result of one send attempt.
 *
 * The lease columns always carry a value, `null` when there is none, so a terminal row
 * does not sit there looking claimed forever: a stale `leaseHolder` on a `sent` row is
 * exactly what makes a later reader unsure whether a crashed worker is still going.
 *
 * NOTE: writing `leaseHolder` here does not ACQUIRE anything. Airtable has no
 * compare-and-swap, so two callers can both write it and both believe they won.
 * Claiming is `claimOnce()` in `@/utils/cf.ts`, backed by the ClaimGuard Durable
 * Object; these columns only record what that decided.
 */
export function outboxOutcomeFields(outcome: OutboxOutcome): FieldSet {
  return {
    [COL.status]: outcome.status,
    [COL.attempts]: outcome.attempts,
    [COL.leaseHolder]: outcome.leaseHolder ?? null,
    [COL.leaseExpiresAt]: outcome.leaseExpiresAt ?? null,
    // Absent means "no news", so these three are omitted rather than cleared: a
    // retry that fails must not erase the provider id or the error from the attempt
    // before it.
    ...compact({
      [COL.providerMessageId]: outcome.providerMessageId,
      [COL.lastError]: outcome.lastError,
      [COL.sentAt]: outcome.sentAt,
    }),
  }
}

export type SubmissionRoundDraft = {
  submissionId: RecordId
  roundId: RecordId
  status?: 'pending' | 'in_review' | 'advanced' | 'rejected'
  enteredAt: string
}

/** A submission entering a round. Section 5.1b writes one per abstract at submit. */
export function submissionRoundFields(draft: SubmissionRoundDraft): FieldSet {
  return compact({
    [COL.submission]: link(draft.submissionId),
    [COL.round]: link(draft.roundId),
    [COL.status]: draft.status ?? 'pending',
    [COL.enteredAt]: draft.enteredAt,
  })
}
