// EmailTemplates, EmailOutbox, IntegrationMappings, SyncLog.
//
// EmailOutbox leads with `idempotencyKey`, and that is not just the primary-field
// rule being satisfied: it is the only key in this base that `client.upsertRecords`
// can merge on, because Airtable cannot merge on a linked-record field. Making it
// the primary field is what keeps a retried enqueue from queueing a second copy of
// the same message.

import { OUTBOX_STATUSES } from '@/constants/status'
import {
  checkboxField,
  dateTimeField,
  emailField,
  link,
  longText,
  numberField,
  select,
  type TableSpec,
  text,
} from '@/migrations/schema-types'
import { COL, TABLES } from '@/services/airtable/tables'

const TEMPLATE_SOURCES = ['template', 'form_inline', 'system']
const MAPPING_ENTITIES = ['speaker', 'submission', 'track', 'tag', 'room', 'ticket_type']
const SYNC_LOG_ENTITIES = ['speaker', 'submission', 'track', 'tag']
const SYNC_ACTIONS = ['create', 'update', 'skip']
const SYNC_STATUSES = ['ok', 'failed']

const emailTemplates: TableSpec = {
  name: TABLES.emailTemplates,
  fields: [
    // `accepted`, `rejected`, `reminder`, or `custom-*`, so text and not a select:
    // the custom half has no fixed vocabulary.
    text(COL.key),
    link(COL.event, TABLES.events),
    text(COL.subject),
    longText(COL.bodyMarkdown),
    checkboxField(COL.attachIcs),
  ],
}

const emailOutbox: TableSpec = {
  name: TABLES.emailOutbox,
  fields: [
    text(COL.idempotencyKey),
    link(COL.event, TABLES.events),
    // Optional, and `templateSource` says why: the submission confirmation and the
    // two admin alerts are authored inline on the form, and the magic link has no
    // admin-editable body at all. The link is provenance for the Comms log rather
    // than an input to sending, because `payloadJson` already holds what was sent.
    link(COL.template, TABLES.emailTemplates),
    select(COL.templateSource, TEMPLATE_SOURCES),
    link(COL.form, TABLES.forms),
    link(COL.speaker, TABLES.speakers),
    link(COL.submission, TABLES.submissions),
    link(COL.task, TABLES.tasks),
    longText(COL.payloadJson),
    emailField(COL.toEmail),
    dateTimeField(COL.sendAt),
    select(COL.status, OUTBOX_STATUSES),
    numberField(COL.attempts),
    // These two RECORD a claim, they do not grant one: claiming is claimOnce() in
    // src/utils/cf.ts, backed by the ClaimGuard Durable Object, because Airtable
    // has no compare-and-swap and two writers here would both believe they won.
    text(COL.leaseHolder),
    dateTimeField(COL.leaseExpiresAt),
    text(COL.providerMessageId),
    text(COL.lastError),
    dateTimeField(COL.sentAt),
  ],
}

const integrationMappings: TableSpec = {
  name: TABLES.integrationMappings,
  fields: [
    text(COL.localId),
    link(COL.event, TABLES.events),
    select(COL.entityType, MAPPING_ENTITIES),
    text(COL.remoteId),
    // Hash of the last payload accepted, so a retry whose hash matches is a no-op
    // rather than a redundant update.
    text(COL.requestHash),
    dateTimeField(COL.syncedAt),
  ],
}

const syncLog: TableSpec = {
  name: TABLES.syncLog,
  fields: [
    dateTimeField(COL.at),
    link(COL.event, TABLES.events),
    select(COL.entityType, SYNC_LOG_ENTITIES),
    text(COL.localId),
    text(COL.remoteId),
    select(COL.action, SYNC_ACTIONS),
    select(COL.status, SYNC_STATUSES),
    longText(COL.payloadJson),
    longText(COL.error),
  ],
}

/**
 * Who changed what, and when.
 *
 * NOT from BUILD_SPEC section 3, and the only table declared here that is not. It exists
 * because a content edit that leaves no trace is indistinguishable from no edit: an
 * organizer who finds a session retitled the week of the event has no way to ask who did
 * it or what it said before.
 *
 * One row per FIELD changed rather than per save, which is why `fieldLabel`,
 * `previousValue` and `newValue` are scalar rather than a stored JSON diff. The history is
 * read by a person, and a diff would need a renderer nobody would write.
 *
 * `at` leads because Airtable will not take a link as the primary field and the rest of
 * the table is links and free text. `editorName` is denormalised text rather than a link
 * to AdminUsers on purpose: a speaker editing through the portal is also an editor, and an
 * attribution that survives the account being deleted is the useful one.
 */
const contentRevisions: TableSpec = {
  name: TABLES.contentRevisions,
  fields: [
    dateTimeField(COL.at),
    link(COL.event, TABLES.events),
    link(COL.submission, TABLES.submissions),
    text(COL.fieldLabel),
    longText(COL.previousValue),
    longText(COL.newValue),
    text(COL.editorName),
  ],
}

/**
 * A comment on one uploaded file, with who wrote it and when.
 *
 * Append-only, exactly like ContentRevisions above and for the same reason: a thread an
 * organizer can quietly rewrite is not a record of what was asked for. There is no speaker
 * link, on purpose; a comment belongs to the FILE, and the file already knows whose it is.
 */
const fileComments: TableSpec = {
  name: TABLES.fileComments,
  fields: [
    dateTimeField(COL.at),
    link(COL.event, TABLES.events),
    link(COL.file, TABLES.files),
    longText(COL.body),
    // Snapshotted rather than joined through a link, the same call ContentRevisions makes:
    // the name beside a comment is who wrote it AT THE TIME, and an organizer removed from
    // the event later must not turn their past comments anonymous.
    text(COL.authorName),
  ],
}

export const COMMS_TABLES: readonly TableSpec[] = [
  emailTemplates,
  emailOutbox,
  integrationMappings,
  syncLog,
  contentRevisions,
  fileComments,
]
