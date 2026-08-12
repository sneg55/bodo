// Files, Tasks, TaskAssignments, FileRequests, FileRequestAssignments,
// PortalItems, Resources.
//
// Split from tables-core.ts for the file-size limit. Same primary-field rule, so
// the two assignment tables lead with their completion timestamp and PortalItems
// leads with `order`.
//
// Files has no url column and that is the schema's decision, not an omission:
// `objectKey` is the durable identifier, a public link is derived from
// R2_PUBLIC_BASE_URL at read time and a private one is served through an
// authenticated route. Baking a URL into the row freezes both the bucket domain and
// the access model.

import { TASK_ENTITY_TYPES } from '@/constants/status'
import {
  checkboxField,
  dateTimeField,
  link,
  longText,
  numberField,
  select,
  type TableSpec,
  text,
} from '@/migrations/schema-types'
import { COL, TABLES } from '@/services/airtable/tables'

const FILE_KINDS = ['headshot', 'slides', 'doc']
const VISIBILITIES = ['public', 'private']
const TASK_ORIGINS = ['manual', 'automated']
const TASK_KINDS = ['upload', 'form', 'link', 'confirm']
const TASK_APPLIES_TO = ['all_accepted']
const ASSIGNMENT_STATUSES = ['pending', 'done']
const REQUEST_STATUSES = ['pending', 'received']
const PORTAL_ITEM_TYPES = ['task', 'form', 'file_request', 'resource']
const RESOURCE_VISIBILITIES = ['portal', 'public']

const files: TableSpec = {
  name: TABLES.files,
  fields: [
    text(COL.objectKey),
    link(COL.speaker, TABLES.speakers),
    link(COL.submission, TABLES.submissions),
    link(COL.fileRequestAssignment, TABLES.fileRequestAssignments),
    select(COL.kind, FILE_KINDS),
    select(COL.visibility, VISIBILITIES),
    text(COL.contentType),
    text(COL.filename),
    numberField(COL.size),
    dateTimeField(COL.uploadedAt),
    // Written only after the server HEADs the object, so a row never claims bytes
    // that were not stored. Blank is a state the portal has to render.
    dateTimeField(COL.verifiedAt),
  ],
}

const tasks: TableSpec = {
  name: TABLES.tasks,
  fields: [
    text(COL.title),
    link(COL.event, TABLES.events),
    longText(COL.description),
    select(COL.entityType, TASK_ENTITY_TYPES),
    select(COL.origin, TASK_ORIGINS),
    select(COL.kind, TASK_KINDS),
    link(COL.form, TABLES.forms),
    dateTimeField(COL.dueAt),
    select(COL.appliesTo, TASK_APPLIES_TO),
  ],
}

const taskAssignments: TableSpec = {
  name: TABLES.taskAssignments,
  fields: [
    dateTimeField(COL.completedAt),
    link(COL.task, TABLES.tasks),
    link(COL.speaker, TABLES.speakers),
    // Required by section 3 when the task is submission-scoped, and the schema
    // cannot say so: a contact task has no submission and is not broken for it.
    link(COL.submission, TABLES.submissions),
    select(COL.status, ASSIGNMENT_STATUSES),
    longText(COL.answersJson),
  ],
}

const fileRequests: TableSpec = {
  name: TABLES.fileRequests,
  fields: [
    text(COL.title),
    link(COL.event, TABLES.events),
    select(COL.entityType, TASK_ENTITY_TYPES),
    longText(COL.instructionsHtml),
    checkboxField(COL.required),
    dateTimeField(COL.dueAt),
    dateTimeField(COL.createdAt),
  ],
}

const fileRequestAssignments: TableSpec = {
  name: TABLES.fileRequestAssignments,
  fields: [
    dateTimeField(COL.receivedAt),
    link(COL.fileRequest, TABLES.fileRequests),
    link(COL.speaker, TABLES.speakers),
    link(COL.submission, TABLES.submissions),
    select(COL.status, REQUEST_STATUSES),
  ],
}

const portalItems: TableSpec = {
  name: TABLES.portalItems,
  fields: [
    numberField(COL.order),
    link(COL.event, TABLES.events),
    select(COL.itemType, PORTAL_ITEM_TYPES),
    // Exactly one of the next four is set per row, which `itemType` names. Four
    // nullable links rather than four `enabled` flags spread across four tables,
    // because only a row can carry an ordering.
    link(COL.task, TABLES.tasks),
    link(COL.form, TABLES.forms),
    link(COL.fileRequest, TABLES.fileRequests),
    link(COL.resource, TABLES.resources),
    checkboxField(COL.enabled),
  ],
}

const resources: TableSpec = {
  name: TABLES.resources,
  fields: [
    text(COL.title),
    link(COL.event, TABLES.events),
    text(COL.slug),
    longText(COL.bodyMarkdown),
    longText(COL.embedHtml),
    select(COL.visibility, RESOURCE_VISIBILITIES),
    numberField(COL.order),
  ],
}

export const PORTAL_TABLES: readonly TableSpec[] = [
  files,
  tasks,
  taskAssignments,
  fileRequests,
  fileRequestAssignments,
  portalItems,
  resources,
]
