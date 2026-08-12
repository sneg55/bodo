import type { AgendaOptimisticAction, AgendaSession } from './types'

export function reduceAgendaSessions(
  sessions: readonly AgendaSession[],
  action: AgendaOptimisticAction,
): readonly AgendaSession[] {
  if (action.type === 'publication') {
    const selected = new Set(action.submissionIds)
    return sessions.map((session) =>
      selected.has(session.id)
        ? {
            ...session,
            scheduleStatus: action.published ? 'published' : publicationFallback(session),
          }
        : session,
    )
  }

  return sessions.map((session) =>
    session.id === action.change.submissionId
      ? {
          ...session,
          roomId: action.change.roomId,
          startsAt: action.change.startsAt,
          endsAt: action.change.endsAt,
          scheduleStatus: action.scheduleStatus,
        }
      : session,
  )
}

function publicationFallback(session: AgendaSession): AgendaSession['scheduleStatus'] {
  return session.roomId === undefined ||
    session.startsAt === undefined ||
    session.endsAt === undefined
    ? 'unscheduled'
    : 'scheduled'
}
