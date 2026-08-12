// Airtable's own column names. Table names are in ./table-names.ts and re-exported here,
// so one import still reaches both.
//
// Two reasons this is a registry rather than string literals at each use site.
// Airtable field names must not leak past this directory (BUILD_SPEC 3.1), and a
// renamed column should be a one-line change here rather than a grep across the
// mappers. Schema of record is BUILD_SPEC section 3.

import { COL_API } from '@/services/airtable/columns-api'
import { COL_CMS } from '@/services/airtable/columns-cms'
import { COL_CRM } from '@/services/airtable/columns-crm'
import { COL_REVIEW } from '@/services/airtable/columns-review'
import { COL_WEBHOOKS } from '@/services/airtable/columns-webhooks'

export { TABLES, type TableName } from '@/services/airtable/table-names'

/**
 * Column names. Flat rather than nested per table because section 3 uses one name
 * for one concept throughout: `event` is the event link on every table that has
 * one, `order` is the sort column on every ordered lookup.
 */
export const COL = {
  // Links
  event: 'event',
  events: 'events',
  form: 'form',
  submission: 'submission',
  speaker: 'speaker',
  submitter: 'submitter',
  round: 'round',
  reviewer: 'reviewer',
  plan: 'plan',
  user: 'user',
  room: 'room',
  track: 'track',
  tags: 'tags',
  viaTeam: 'viaTeam',
  team: 'team',
  task: 'task',
  template: 'template',
  fileRequestAssignment: 'fileRequestAssignment',
  portal: 'portal',

  // Shared scalars
  name: 'name',
  title: 'title',
  status: 'status',
  order: 'order',
  color: 'color',
  description: 'description',
  email: 'email',
  role: 'role',
  kind: 'kind',
  entityType: 'entityType',
  capacity: 'capacity',
  location: 'location',
  source: 'source',
  comment: 'comment',
  recommendation: 'recommendation',

  // Events
  slug: 'slug',
  eventType: 'eventType',
  websiteUrl: 'websiteUrl',
  timezone: 'timezone',
  theme: 'theme',
  logoUrl: 'logoUrl',
  backgroundUrl: 'backgroundUrl',
  cfpDeadline: 'cfpDeadline',
  submissionLimitPerUser: 'submissionLimitPerUser',
  accelEventUrl: 'accelEventUrl',
  accelEventId: 'accelEventId',
  accelSyncEnabled: 'accelSyncEnabled',

  // Speakers
  salutation: 'salutation',
  firstName: 'firstName',
  lastName: 'lastName',
  honorific: 'honorific',
  pronouns: 'pronouns',
  gender: 'gender',
  phone: 'phone',
  bio: 'bio',
  tagline: 'tagline',
  company: 'company',
  headshotUrl: 'headshotUrl',
  /**
   * Section 3 calls this column `links`; the JSON-blob convention everywhere else
   * in the schema is a `...Json` suffix, and the DAL brief names it `linksJson`.
   * Both are read (linksJson first) because the base does not exist yet, so
   * guessing wrong would be a silent empty social-links panel rather than an
   * error. The migration in src/migrations should settle on `linksJson`.
   */
  linksJson: 'linksJson',
  links: 'links',

  // Submissions
  code: 'code',
  answersJson: 'answersJson',
  notifiedAt: 'notifiedAt',
  submittedAt: 'submittedAt',
  startsAt: 'startsAt',
  endsAt: 'endsAt',
  scheduleStatus: 'scheduleStatus',
  // Where the session's CONTENT stands, which is not its acceptance status and not its
  // schedule status. See CONTENT_STATUSES for why it needed a column of its own.
  contentStatus: 'contentStatus',
  clientSessionId: 'clientSessionId',
  reviewRequired: 'reviewRequired',
  calendarUid: 'calendarUid',
  calendarSequence: 'calendarSequence',
  calendarDtstamp: 'calendarDtstamp',
  calendarStatus: 'calendarStatus',
  format: 'format',
  level: 'level',
  language: 'language',
  ceuCredits: 'ceuCredits',

  // SubmissionParticipants
  isPrimary: 'isPrimary',
  sortOrder: 'sortOrder',

  // Forms
  publicId: 'publicId',
  entityKind: 'entityKind',
  participantsEnabled: 'participantsEnabled',
  welcomeHtml: 'welcomeHtml',
  successHtml: 'successHtml',
  fieldsJson: 'fieldsJson',
  participantFieldsJson: 'participantFieldsJson',
  routingJson: 'routingJson',
  rolesJson: 'rolesJson',
  crossFieldLimitsJson: 'crossFieldLimitsJson',
  closeDate: 'closeDate',
  submissionLimit: 'submissionLimit',
  allowMultipleDrafts: 'allowMultipleDrafts',
  autoRedirectToPortal: 'autoRedirectToPortal',
  confirmationEmailEnabled: 'confirmationEmailEnabled',
  confirmationEmailHtml: 'confirmationEmailHtml',
  adminAlertOnNew: 'adminAlertOnNew',
  adminAlertOnUpdate: 'adminAlertOnUpdate',
  /**
   * The participant-facing headings, one set per wizard step that has one. Split
   * rather than a single `headingsJson` because each is a plain string with its own
   * character cap that a counter renders, and a blob would put four independent
   * required fields behind one parse. `internal` name stays `name`: that is the one
   * the organizer searches the forms list by, and it predates these.
   */
  externalTitle: 'externalTitle',
  welcomeHeading: 'welcomeHeading',
  abstractSectionTitle: 'abstractSectionTitle',
  abstractHeading: 'abstractHeading',
  abstractSectionHtml: 'abstractSectionHtml',
  participantSectionTitle: 'participantSectionTitle',
  participantHeading: 'participantHeading',
  participantSectionHtml: 'participantSectionHtml',

  // Tasks and TaskAssignments
  origin: 'origin',
  appliesTo: 'appliesTo',
  dueAt: 'dueAt',
  completedAt: 'completedAt',

  // Files. `objectKey` is the durable identifier and there is deliberately no
  // url column: a public link is derived from R2_PUBLIC_BASE_URL at read time and
  // a private one is served through an authenticated route. Section 3.
  objectKey: 'objectKey',
  visibility: 'visibility',
  contentType: 'contentType',
  filename: 'filename',
  size: 'size',
  uploadedAt: 'uploadedAt',
  verifiedAt: 'verifiedAt',

  // EmailOutbox
  templateSource: 'templateSource',
  idempotencyKey: 'idempotencyKey',
  payloadJson: 'payloadJson',
  toEmail: 'toEmail',
  sendAt: 'sendAt',
  attempts: 'attempts',
  leaseHolder: 'leaseHolder',
  leaseExpiresAt: 'leaseExpiresAt',
  providerMessageId: 'providerMessageId',
  lastError: 'lastError',
  sentAt: 'sentAt',

  // Accelevents integration mappings and attempt log
  localId: 'localId',
  remoteId: 'remoteId',
  requestHash: 'requestHash',
  syncedAt: 'syncedAt',
  action: 'action',
  error: 'error',
  at: 'at',

  // Speaker logistics. Free text and not selects, because a dietary requirement and a
  // travel arrangement are exactly the fields no vocabulary survives contact with: an
  // organizer needs to write "coeliac, and no shellfish" rather than pick from a list
  // somebody guessed at.
  dietary: 'dietary',
  travelNotes: 'travelNotes',

  /**
   * When this speaker was last sent a portal invitation, on `Speakers`.
   *
   * Distinct from `notifiedAt` on `Submissions`, which is about one talk's decision. This
   * is about the PERSON: an organizer inviting a roster imported from a spreadsheet needs
   * to know who has already been written to, and a decision stamp cannot answer that for
   * somebody who has no submission at all.
   *
   * It is also the epoch in the invite's idempotency key, exactly as `notifiedAt` is for a
   * decision, so a double-clicked button sends one email and a deliberate re-invite next
   * month sends a second.
   */
  invitedAt: 'invitedAt',

  // Content revisions. `fieldLabel` and not `field`, because the value stored is the
  // label a person reads ("Title", "Abstract") rather than a column name: the history is
  // read by an organizer, and a registry key in it would say nothing to them.
  fieldLabel: 'fieldLabel',
  previousValue: 'previousValue',
  newValue: 'newValue',
  editorName: 'editorName',

  // Tables section 3 declares that no mapper reads yet: EmailTemplates,
  // Resources, PortalItems, SavedViews, FileRequests, FileRequestAssignments.
  // They are registered here anyway, because src/migrations has to create those
  // columns and a migration that spelled them itself would be a second registry:
  // the day a mapper lands, the two would be free to disagree and the symptom
  // would be a column that reads as empty.
  key: 'key',
  subject: 'subject',
  bodyMarkdown: 'bodyMarkdown',
  attachIcs: 'attachIcs',
  embedHtml: 'embedHtml',
  itemType: 'itemType',
  fileRequest: 'fileRequest',
  resource: 'resource',
  enabled: 'enabled',
  surface: 'surface',
  owner: 'owner',
  columnsJson: 'columnsJson',
  sortJson: 'sortJson',
  filterJson: 'filterJson',
  isDefault: 'isDefault',
  instructionsHtml: 'instructionsHtml',
  required: 'required',
  createdAt: 'createdAt',
  receivedAt: 'receivedAt',

  // Portals (BUILD_SPEC 5.0c). `filterJson`, `isDefault`, `name`, `kind` and `order`
  // are already above: one name for one concept, per the header. These four are the
  // per-portal settings the help centre documents and nothing else carries.
  welcomeMessage: 'welcomeMessage',
  alwaysShowTasks: 'alwaysShowTasks',
  manageProfile: 'manageProfile',

  // ImportRuns (BUILD_SPEC 5.0e). `source`, `status`, `error`, `leaseHolder` and
  // `leaseExpiresAt` are already above. There is deliberately NO credential column:
  // a Sessionboard organization token is read for the run and stored nowhere.
  sourceRef: 'sourceRef',
  mappingJson: 'mappingJson',
  phase: 'phase',
  counts: 'counts',
  needsEmailJson: 'needsEmailJson',

  // Shared by ImportRuns and AiPrescreenJobs, which is the header's rule working rather
  // than a collision: both are queued jobs and both mean the same two instants by these
  // names. They are spelled apart from `sentAt` and `syncedAt` because a job has three
  // distinct instants and collapsing any two loses the answer to "is it stuck or slow".
  startedAt: 'startedAt',
  finishedAt: 'finishedAt',

  // AiPrescreenJobs. The queue reuses `status`, `attempts` and `error`, which already
  // mean the same things on EmailOutbox and SyncLog.
  queuedAt: 'queuedAt',
  // Sample or model, on the job that wrote the review. Orthogonal to `status`, so a
  // checkbox rather than two more select values meaning `done-mocked` and `done-live`.
  mocked: 'mocked',

  // CmsEmbeds and Dashboards live in columns-cms.ts, SpeakerTags and SpeakerLists in
  // columns-crm.ts, and the review-side columns in columns-review.ts. All three moved when
  // this file crossed the size limit, on three separate occasions; nothing about how they
  // are used changed, because `COL` is still one object with one entry per concept.
  ...COL_API,
  ...COL_WEBHOOKS,
  ...COL_CMS,
  ...COL_CRM,
  ...COL_REVIEW,
} as const

/** Rendered form of the `code` autonumber, shown to speakers. Section 3. */
export const CODE_PREFIX = 'SESS-'
