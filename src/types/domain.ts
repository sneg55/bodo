// App-shaped entity types. These are what the rest of the codebase sees.
//
// Airtable's own field names, record wrappers, and link-array quirks never leave
// `src/services/airtable`, which maps records to these types and validates on the
// way through. Anything here is already trustworthy.
//
// Schema of record is BUILD_SPEC §3. Where a name differs from Airtable's column
// name, the DAL mapping is the only place that knows.

import type { DataTableFilter } from '@/components/primitives/data-table-types'
import type {
  ContentStatus,
  EventRole,
  FormEntityKind,
  OutboxStatus,
  ParticipantRole,
  ReviewRecommendation,
  ScheduleStatus,
  SpeakerStatus,
  SubmissionRoundStatus,
  SubmissionSource,
  SubmissionStatus,
  TaskEntityType,
} from '@/constants/status'

import type { RecordId } from '@/types/ids'

export type { RecordId } from '@/types/ids'

/**
 * The review graph lives in `@/types/review` and is re-exported here.
 *
 * It moved when the criterion kinds and the per-round settings pushed this file past
 * the size limit. Re-exported rather than relocated at the call sites, because these
 * names are imported from `@/types/domain` in roughly a hundred places and a rename
 * sweep would bury the one change that actually matters.
 */
export type {
  Criterion,
  CriterionKind,
  CriterionOption,
  EvaluationPlan,
  Review,
  ReviewAssignment,
  ReviewTeam,
  Round,
  SubmissionRound,
} from '@/types/review'

export type Event = {
  id: RecordId
  name: string
  slug: string
  eventType: string
  websiteUrl?: string
  location?: string
  startsAt?: string
  endsAt?: string
  timezone: string
  theme?: string
  logoUrl?: string
  backgroundUrl?: string
  cfpDeadline?: string
  submissionLimitPerUser?: number
  status: 'draft' | 'open' | 'closed'
  accelEventUrl?: string
  accelEventId?: string
  accelSyncEnabled: boolean
}

export type Speaker = {
  id: RecordId
  email: string
  salutation?: string
  firstName: string
  lastName: string
  honorific?: string
  pronouns?: string
  gender?: string
  phone?: string
  bio?: string
  tagline?: string
  company?: string
  headshotUrl?: string
  /**
   * Where the PERSON is in the organizer's process, independent of where their submission
   * is. Optional because every row written before the column existed has none, and absent
   * reads as `prospect` at the surfaces that group by it.
   */
  status?: SpeakerStatus
  /** Free-text logistics. The migration records why these are not selects. */
  dietary?: string
  travelNotes?: string
  /**
   * When this person was last sent a portal invitation, or absent if never. Read by the
   * roster's Invited column and by the invite's idempotency key.
   */
  invitedAt?: string
  links: SpeakerLinks
}

export type SpeakerLinks = {
  linkedin?: string
  x?: string
  facebook?: string
  website?: string
}

/** A cross-event CRM label. Distinct from `Tag`, which is event-scoped and describes tracks. */
export type SpeakerTag = {
  id: RecordId
  name: string
  color: string
}

/**
 * A saved speaker filter, re-evaluated on every read so newly matching speakers appear
 * without the list being edited. That re-evaluation is what makes it "dynamic".
 */
export type SpeakerList = {
  id: RecordId
  name: string
  ownerId?: RecordId
  isShared: boolean
  filters: readonly DataTableFilter[]
}

export type Submission = {
  id: RecordId
  eventId: RecordId
  /** Null for `source: 'manual'`. */
  formId?: RecordId
  submitterId: RecordId
  /** Rendered as `SESS-<n>`. */
  code: string
  title: string
  status: SubmissionStatus
  source: SubmissionSource
  /** Stamped at creation from the form's entityKind. Never re-read from the form. */
  reviewRequired: boolean
  answers: Record<string, unknown>
  format?: string
  level?: string
  /** The language the session is DELIVERED in. Not a UI locale. */
  language?: string
  ceuCredits?: number
  trackId?: RecordId
  tagIds: readonly RecordId[]
  submittedAt?: string
  notifiedAt?: string
  roomId?: RecordId
  startsAt?: string
  endsAt?: string
  scheduleStatus: ScheduleStatus
  /** Where the session's content stands. Defaults to `not_submitted`. */
  contentStatus: ContentStatus
  capacity?: number
  location?: string
  clientSessionId?: string
  calendarUid?: string
  calendarSequence: number
  calendarDtstamp?: string
  calendarStatus: 'active' | 'cancelled'
}

export type SubmissionParticipant = {
  id: RecordId
  submissionId: RecordId
  speakerId: RecordId
  role: ParticipantRole
  isPrimary: boolean
  sortOrder: number
}

/** A submission with its cast resolved. What most surfaces actually want. */
export type SubmissionWithParticipants = Submission & {
  participants: readonly (SubmissionParticipant & { speaker: Speaker })[]
}

export type Track = { id: RecordId; eventId: RecordId; name: string; color: string; order: number }
export type Tag = { id: RecordId; eventId: RecordId; name: string; color: string }
export type Room = {
  id: RecordId
  eventId: RecordId
  name: string
  capacity?: number
  order: number
}

export type AdminUser = { id: RecordId; email: string; name: string }

export type EventMembership = {
  id: RecordId
  eventId: RecordId
  userId: RecordId
  role: EventRole
  addedAt: string
}

export type Task = {
  id: RecordId
  eventId: RecordId
  title: string
  description?: string
  entityType: TaskEntityType
  origin: 'manual' | 'automated'
  kind: 'upload' | 'form' | 'link' | 'confirm'
  formId?: RecordId
  dueAt?: string
  appliesTo?: 'all_accepted'
}

export type TaskAssignment = {
  id: RecordId
  taskId: RecordId
  speakerId: RecordId
  submissionId?: RecordId
  status: 'pending' | 'done'
  completedAt?: string
  answers?: Record<string, unknown>
}

export type StoredFile = {
  id: RecordId
  speakerId: RecordId
  submissionId?: RecordId
  fileRequestAssignmentId?: RecordId
  kind: 'headshot' | 'image' | 'slides' | 'doc'
  objectKey: string
  visibility: 'public' | 'private'
  contentType: string
  filename: string
  size: number
  uploadedAt: string
  verifiedAt?: string
}

export type EmailTemplate = {
  id: RecordId
  eventId: RecordId
  key: string
  subject: string
  bodyMarkdown: string
  attachIcs: boolean
}

export type OutboxRow = {
  id: RecordId
  eventId: RecordId
  templateId?: RecordId
  templateSource: 'template' | 'form_inline' | 'system'
  formId?: RecordId
  speakerId?: RecordId
  submissionId?: RecordId
  taskId?: RecordId
  idempotencyKey: string
  payload: OutboxPayload
  toEmail: string
  sendAt: string
  status: OutboxStatus
  attempts: number
  leaseHolder?: string
  leaseExpiresAt?: string
  providerMessageId?: string
  lastError?: string
  sentAt?: string
}

/** Snapshotted at enqueue so a later template edit cannot change promised mail. */
export type OutboxPayload = {
  subject: string
  html: string
  attachIcs: boolean
  /** The slot a cancellation refers to. See `outboxPayloadSchema` for why it is snapshotted. */
  cancelledSlot?: { startsAt: string; endsAt: string; room?: string }
}
