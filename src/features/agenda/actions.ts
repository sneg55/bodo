'use server'

import { AppError, ErrorIds } from '@/constants/errorIds'
import { announcePublications } from '@/features/agenda/announce-published'
import type { AutoScheduleSkip } from '@/features/agenda/auto-schedule'
import { planAutoSchedule } from '@/features/agenda/auto-schedule'
import { getAgendaData } from '@/features/agenda/read-model'
import type { UnresolvedConflict } from '@/features/agenda/resolve-conflicts'
import { planConflictResolution } from '@/features/agenda/resolve-conflicts'
import { applySchedule } from '@/features/agenda/schedule-write'
import { requireEventRole } from '@/features/auth/wiring'
import { invalidate } from '@/services/airtable/invalidate'
import {
  createSubmission,
  type ScheduleChange,
  scheduleSubmission,
} from '@/services/airtable/mutations'
import {
  getSubmission,
  listRooms,
  listSpeakers,
  listSubmissions,
} from '@/services/airtable/queries'
import { eventAgendaPublishedTag } from '@/services/airtable/tags'

import type { ScheduleRequest } from './types'

export async function scheduleSessionAction(
  eventId: string,
  request: ScheduleRequest,
): Promise<void> {
  await requireEventRole(eventId, 'admin')
  const submission = await getSubmission(request.submissionId)
  requireAgendaOwner(eventId, submission.eventId, request.submissionId)
  requireAccepted(submission.status, request.submissionId)
  const slot = await validatedSlot(eventId, request)
  const scheduleStatus =
    slot.roomId === undefined
      ? 'unscheduled'
      : submission.scheduleStatus === 'published'
        ? 'published'
        : 'scheduled'

  // Through `applySchedule`, not `scheduleSubmission`: moving a session is what sends the
  // updated invite, and the submission has already been read here so the write costs no
  // second read. See features/agenda/schedule-write.ts.
  await applySchedule(
    {
      eventId,
      submissionId: submission.id,
      ...slot,
      scheduleStatus,
    },
    submission,
  )
}

export async function setSessionPublicationAction(
  eventId: string,
  submissionIds: readonly string[],
  published: boolean,
): Promise<void> {
  await requireEventRole(eventId, 'admin')
  const requestedIds = new Set(submissionIds)
  const sessions = (await listSubmissions(eventId)).filter((session) =>
    requestedIds.has(session.id),
  )
  requireEverySession(
    submissionIds,
    sessions.map((session) => session.id),
  )
  const changes = sessions.flatMap((session) => {
    const change = publicationChange(eventId, session, published)
    return change === undefined ? [] : [change]
  })

  await persistPublication(changes, eventId)
  // After the write, and from HERE rather than from the loop: this is the last frame that
  // still holds the sessions' codes and titles. See ./announce-published.ts.
  await announcePublications(eventId, changes, sessions)
}

export async function setAgendaPublicationAction(
  eventId: string,
  published: boolean,
): Promise<void> {
  await requireEventRole(eventId, 'admin')
  const sessions = await listSubmissions(eventId)
  const candidates = sessions.filter((session) =>
    published ? session.scheduleStatus === 'scheduled' : session.scheduleStatus === 'published',
  )
  const changes = candidates.flatMap((session) => {
    const change = publicationChange(eventId, session, published)
    return change === undefined ? [] : [change]
  })

  await persistPublication(changes, eventId)
  await announcePublications(eventId, changes, candidates)
}

export async function createSessionAction(eventId: string, formData: FormData): Promise<string> {
  await requireEventRole(eventId, 'admin')
  const title = requiredFormText(formData, 'title')
  const speakerId = requiredFormText(formData, 'speakerId')
  const format = optionalFormText(formData, 'format')
  if (title.length > 255) {
    throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, 'session title exceeds 255 characters')
  }
  const speakers = await listSpeakers(eventId)
  if (!speakers.some((speaker) => speaker.id === speakerId)) {
    throw new AppError(ErrorIds.DATA_MISSING_LINK, 'session speaker does not belong to event', {
      eventId,
      speakerId,
    })
  }

  const submission = await createSubmission({
    draft: {
      eventId,
      submitterId: speakerId,
      title,
      status: 'accepted',
      source: 'manual',
      reviewRequired: false,
      answers: {},
      format,
    },
    participants: [{ speakerId, role: 'speaker', isPrimary: true, sortOrder: 1 }],
  })
  await scheduleSubmission({
    eventId,
    submissionId: submission.id,
    scheduleStatus: 'unscheduled',
  })
  return submission.id
}

async function validatedSlot(eventId: string, request: ScheduleRequest) {
  const empty =
    request.roomId === undefined && request.startsAt === undefined && request.endsAt === undefined
  if (empty) return { roomId: undefined, startsAt: undefined, endsAt: undefined }
  if (
    request.roomId === undefined ||
    request.startsAt === undefined ||
    request.endsAt === undefined
  ) {
    throw invalidSchedule(request.submissionId, 'room, start, and end must be set together')
  }
  const start = Date.parse(request.startsAt)
  const end = Date.parse(request.endsAt)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    throw invalidSchedule(request.submissionId, 'session end must be after its start')
  }
  const rooms = await listRooms(eventId)
  if (!rooms.some((room) => room.id === request.roomId)) {
    throw invalidSchedule(request.submissionId, 'room does not belong to event')
  }
  return { roomId: request.roomId, startsAt: request.startsAt, endsAt: request.endsAt }
}

function publicationChange(
  eventId: string,
  session: Awaited<ReturnType<typeof listSubmissions>>[number],
  published: boolean,
): ScheduleChange | undefined {
  requireAccepted(session.status, session.id)
  if (published && session.scheduleStatus === 'unscheduled') {
    throw invalidSchedule(session.id, 'schedule a session before publishing it')
  }
  const target = published ? 'published' : 'scheduled'
  if (
    session.scheduleStatus === target ||
    (!published && session.scheduleStatus === 'unscheduled')
  ) {
    return undefined
  }
  return {
    eventId,
    submissionId: session.id,
    roomId: session.roomId,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    scheduleStatus: target,
  }
}

async function persistPublication(
  changes: readonly ScheduleChange[],
  eventId: string,
): Promise<void> {
  // The one schedule write that deliberately does NOT go through `applySchedule`.
  // Publishing changes `scheduleStatus` and nothing a calendar can see, and BUILD_SPEC 5.4
  // is explicit that invites follow the schedule change rather than the publication. The
  // planner agrees and would return `none` for every row here; calling it anyway would buy
  // one Airtable read per session on a button that already reads the whole list. If a
  // publication ever starts moving a session, route it through `applySchedule` instead.
  for (const change of changes) {
    await scheduleSubmission(change)
  }
  if (changes.length > 0) {
    // `scheduleSubmission` expires the agenda tags. The published tag is this action's
    // own doing, because it is what the public embeds read, and an organizer who has
    // just pressed Publish expects to be able to open that page and see the change.
    invalidate('action', { own: [eventAgendaPublishedTag(eventId)] })
  }
}

function requireAgendaOwner(eventId: string, ownerId: string, submissionId: string): void {
  if (eventId !== ownerId) {
    throw new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'session does not belong to event', {
      eventId,
      submissionId,
    })
  }
}

function requireAccepted(status: string, submissionId: string): void {
  if (status !== 'accepted') {
    throw new AppError(ErrorIds.SUB_ILLEGAL_TRANSITION, 'only accepted sessions can be scheduled', {
      submissionId,
      status,
    })
  }
}

function requireEverySession(requested: readonly string[], found: readonly string[]): void {
  const foundIds = new Set(found)
  const missing = [...new Set(requested)].filter((id) => !foundIds.has(id))
  if (missing.length > 0) {
    throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'one or more sessions were not found', {
      submissionIds: missing,
    })
  }
}

function requiredFormText(formData: FormData, key: string): string {
  const value = optionalFormText(formData, key)
  if (value === undefined) {
    throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, `${key} is required`, { key })
  }
  return value
}

function optionalFormText(formData: FormData, key: string): string | undefined {
  const value = formData.get(key)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function invalidSchedule(submissionId: string, message: string): AppError {
  return new AppError(ErrorIds.SUB_VALIDATION_FAIL, message, { submissionId })
}
