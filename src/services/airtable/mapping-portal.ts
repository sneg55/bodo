// Mappers for the portal and comms tables: Tasks, TaskAssignments, Files, EmailOutbox.
//
// Split from mapping.ts and mapping-lookups.ts for the line limit. Same three traps
// those files exist to absorb (links are arrays, a blank field is an absent key, a
// JSON blob is text until something validates it) plus one that is specific to these
// tables: a default is only safe when being wrong about it is visible.
//
// So `Files.visibility` defaults to `private` and `EmailOutbox.payloadJson` has no
// default at all. A blank visibility defaulting to public would serve somebody's
// unreleased slides to the internet because an organizer left a cell empty, and an
// empty payload defaulting to `{}` would have the sender deliver a blank email to a
// speaker. Both are unrecoverable once they happen, which is what separates them from
// a missing colour on a track chip.

import { OUTBOX_STATUSES, TASK_ENTITY_TYPES } from '@/constants/status'
import {
  type AirtableRecord,
  choiceOr,
  jsonBlob,
  linkIds,
  numberOr,
  optionalChoice,
  optionalLink,
  optionalText,
  type RecordView,
  requiredChoice,
  requiredLink,
  shapeError,
  text,
  view,
} from '@/services/airtable/records'
import { answersSchema, outboxPayloadSchema } from '@/services/airtable/schemas'
import { COL, TABLES } from '@/services/airtable/tables'
import type { OutboxPayload, OutboxRow, StoredFile, Task, TaskAssignment } from '@/types/domain'

// Vocabularies that live on one table each, declared here rather than in
// src/constants/status.ts. `satisfies` ties every one of them to the domain type it
// reads into, so renaming a member of the union fails the build here instead of
// producing a mapper that silently rejects every row.
const TASK_KINDS = ['upload', 'form', 'link', 'confirm'] as const satisfies readonly Task['kind'][]
const TASK_ORIGINS = ['manual', 'automated'] as const satisfies readonly Task['origin'][]
const TASK_APPLIES_TO = ['all_accepted'] as const satisfies readonly ['all_accepted']
const ASSIGNMENT_STATUSES = [
  'pending',
  'done',
] as const satisfies readonly TaskAssignment['status'][]
const FILE_KINDS = [
  'headshot',
  'image',
  'slides',
  'doc',
] as const satisfies readonly StoredFile['kind'][]
const VISIBILITIES = ['public', 'private'] as const satisfies readonly StoredFile['visibility'][]
const TEMPLATE_SOURCES = [
  'template',
  'form_inline',
  'system',
] as const satisfies readonly OutboxRow['templateSource'][]

export function mapTask(record: AirtableRecord): Task {
  const source = view(TABLES.tasks, record)
  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    title: text(source, COL.title),
    description: optionalText(source, COL.description),
    // A blank entityType surfaces the task under `My Tasks` rather than against a
    // submission, which is the harmless half of being wrong: the speaker still sees
    // it, and no per-submission row is invented for a task that has none.
    entityType: choiceOr(source, COL.entityType, TASK_ENTITY_TYPES, 'contact'),
    origin: choiceOr(source, COL.origin, TASK_ORIGINS, 'manual'),
    // No default. `kind` decides what evidence completion collects, so a blank one
    // read as `confirm` would let a checkbox satisfy an upload the organizer is
    // waiting on, and the task would show as done with nothing attached.
    kind: requiredChoice(source, COL.kind, TASK_KINDS),
    formId: optionalLink(source, COL.form),
    dueAt: optionalText(source, COL.dueAt),
    appliesTo: optionalChoice(source, COL.appliesTo, TASK_APPLIES_TO),
  }
}

/**
 * The same row, or `undefined` when a link it cannot do without has been emptied.
 *
 * `mapTaskAssignment` throws on an empty required link, which is correct when a caller asked
 * for one specific row. It is wrong for a LIST: `loadTaskGraph` maps every assignment in the
 * base before filtering by event, so a single orphan row (delete a task or a speaker and
 * Airtable empties the link, it does not remove the row) made every task dashboard and every
 * portal task list throw. One deleted record took out the surface for every event. Found by
 * Codex review.
 *
 * A skipped row is a row with nothing to belong to, which is exactly what the downstream
 * comments in `taskItems` and `speakerProgress` already claimed happened.
 */
export function mapTaskAssignmentIfIntact(record: AirtableRecord): TaskAssignment | undefined {
  const source = view(TABLES.taskAssignments, record)
  const orphaned =
    linkIds(source, COL.task).length === 0 || linkIds(source, COL.speaker).length === 0
  return orphaned ? undefined : mapTaskAssignment(record)
}

export function mapTaskAssignment(record: AirtableRecord): TaskAssignment {
  const source = view(TABLES.taskAssignments, record)
  return {
    id: source.id,
    taskId: requiredLink(source, COL.task),
    speakerId: requiredLink(source, COL.speaker),
    // Optional on the row and required by section 3 only when the task is
    // submission-scoped, so the shape cannot enforce it: a contact task has no
    // submission and is not broken for lacking one.
    submissionId: optionalLink(source, COL.submission),
    status: choiceOr(source, COL.status, ASSIGNMENT_STATUSES, 'pending'),
    completedAt: optionalText(source, COL.completedAt),
    answers: jsonBlob(source, COL.answersJson, answersSchema, {}),
  }
}

/** The stored name, or the last segment of the key, so a download is never unnamed. */
function fileName(source: RecordView, objectKey: string): string {
  return optionalText(source, COL.filename) ?? objectKey.slice(objectKey.lastIndexOf('/') + 1)
}

export function mapFile(record: AirtableRecord): StoredFile {
  const source = view(TABLES.files, record)
  // Required: a Files row whose objectKey is empty points at no bytes at all, and
  // every consumer of this record is about to build a link out of it.
  const objectKey = text(source, COL.objectKey)

  return {
    id: source.id,
    speakerId: requiredLink(source, COL.speaker),
    submissionId: optionalLink(source, COL.submission),
    fileRequestAssignmentId: optionalLink(source, COL.fileRequestAssignment),
    kind: choiceOr(source, COL.kind, FILE_KINDS, 'doc'),
    objectKey,
    // Private by default, deliberately. See the header.
    visibility: choiceOr(source, COL.visibility, VISIBILITIES, 'private'),
    contentType: optionalText(source, COL.contentType) ?? 'application/octet-stream',
    filename: fileName(source, objectKey),
    size: numberOr(source, COL.size, 0),
    uploadedAt: optionalText(source, COL.uploadedAt) ?? '',
    // Absent means the server never confirmed the bytes, which is a fact a caller
    // may need to act on rather than something to paper over with a timestamp.
    verifiedAt: optionalText(source, COL.verifiedAt),
  }
}

/**
 * The rendered message, snapshotted at enqueue (section 5.3).
 *
 * Missing is an error and not an empty payload: `jsonBlob`'s fallback would hand the
 * sender a blank subject and a blank body, and the sender would deliver it.
 */
function outboxPayload(source: RecordView): OutboxPayload {
  if (optionalText(source, COL.payloadJson) === undefined) {
    throw shapeError(source, COL.payloadJson, 'is required but empty')
  }
  return jsonBlob(source, COL.payloadJson, outboxPayloadSchema, {
    subject: '',
    html: '',
    attachIcs: false,
  })
}

export function mapOutboxRow(record: AirtableRecord): OutboxRow {
  const source = view(TABLES.emailOutbox, record)
  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    // Optional, and `templateSource` says why: the confirmation email and the two
    // admin alerts are authored inline on the form, and the system messages have no
    // admin-editable body at all. Section 5.3.
    templateId: optionalLink(source, COL.template),
    templateSource: choiceOr(source, COL.templateSource, TEMPLATE_SOURCES, 'system'),
    formId: optionalLink(source, COL.form),
    speakerId: optionalLink(source, COL.speaker),
    submissionId: optionalLink(source, COL.submission),
    taskId: optionalLink(source, COL.task),
    idempotencyKey: text(source, COL.idempotencyKey),
    payload: outboxPayload(source),
    toEmail: text(source, COL.toEmail),
    // Required: a row with no send time has no place in a due list, and reading a
    // blank one as "now" would fire a half-written row the moment it was created.
    sendAt: text(source, COL.sendAt),
    status: choiceOr(source, COL.status, OUTBOX_STATUSES, 'queued'),
    attempts: numberOr(source, COL.attempts, 0),
    leaseHolder: optionalText(source, COL.leaseHolder),
    leaseExpiresAt: optionalText(source, COL.leaseExpiresAt),
    providerMessageId: optionalText(source, COL.providerMessageId),
    lastError: optionalText(source, COL.lastError),
    sentAt: optionalText(source, COL.sentAt),
  }
}
