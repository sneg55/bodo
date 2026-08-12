import type {
  ContentStatus,
  ParticipantRole,
  ScheduleStatus,
  SubmissionSource,
  SubmissionStatus,
} from '@/constants/status'

export const AGENDA_VIEWS = ['list', 'day', 'week', 'month', 'rooms', 'conflicts'] as const

export type AgendaView = (typeof AGENDA_VIEWS)[number]

export type AgendaParticipant = {
  id: string
  name: string
  /**
   * The role this person holds ON ONE SESSION, which is what the Chairperson column reads.
   *
   * Optional because the same type is reused for `AgendaData.speakers`, the deduplicated
   * cast list the Add Session picker offers: a person is a chairperson of a session, not of
   * an event, so a role on that list would be whichever session happened to be seen last.
   */
  role?: ParticipantRole
}

export type AgendaRoom = {
  id: string
  name: string
  capacity?: number
}

export type AgendaSession = {
  id: string
  code: string
  title: string
  status: SubmissionStatus
  source: SubmissionSource
  sourceName: string
  format?: string
  level?: string
  language?: string
  ceuCredits?: number
  track?: string
  tags: readonly string[]
  roomId?: string
  room?: string
  startsAt?: string
  endsAt?: string
  scheduleStatus: ScheduleStatus
  /**
   * Carried onto the agenda because it is the second gate on the public page: a published
   * session whose content is not `approved` is withheld from `/agenda/[slug]` and from every
   * embed (`publicSessionRows`). Without this column here the organizer would publish a row,
   * see `Published` on it, and find nothing at the public URL.
   */
  contentStatus: ContentStatus
  capacity?: number
  location?: string
  clientSessionId?: string
  notifiedAt?: string
  submittedAt?: string
  participants: readonly AgendaParticipant[]
}

export type AgendaEvent = {
  id: string
  name: string
  /** Carried so the toolbar can link to `/agenda/{slug}`, the page Publish feeds. */
  slug: string
  timezone: string
  startsAt?: string
  endsAt?: string
}

export type AgendaData = {
  event: AgendaEvent
  rooms: readonly AgendaRoom[]
  sessions: readonly AgendaSession[]
  speakers: readonly AgendaParticipant[]
}

export type ScheduleRequest = {
  submissionId: string
  roomId?: string
  startsAt?: string
  endsAt?: string
}

/**
 * A session the organizer asked to be shown on the grid, sent from the Conflicts tab.
 *
 * Carries the day and the room as well as the id because the timeline picks both on mount:
 * without them the Day view opens on the event's first day and the session is somewhere
 * else, which is the dead end the Conflicts tab was.
 */
export type AgendaFocus = {
  sessionId: string
  /** Local date key (`YYYY-MM-DD`) of the session's start, in the event's timezone. */
  dateKey: string
  roomId: string
}

export type AgendaOptimisticAction =
  | { type: 'schedule'; change: ScheduleRequest; scheduleStatus: ScheduleStatus }
  | { type: 'publication'; submissionIds: readonly string[]; published: boolean }
