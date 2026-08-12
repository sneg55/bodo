'use server'

// The agenda's two BULK planner actions: fill the tray, and unpick the conflicts.
//
// Split out of ./actions.ts at its line budget, and the seam is a real one rather than a
// convenient place to cut. Everything left in that file writes ONE session, or flips
// publication on a list the caller already named; neither of these takes a session id at
// all. Each re-plans the whole agenda from a fresh read and then applies whatever the
// planner decided, so the interesting part is the plan and the write is a loop.
//
// Both plan on the SERVER off their own read, even though the dialog that opens them has
// already computed the same plan on the client for its preview. That is deliberate rather
// than duplicated work: the planners are pure and deterministic, so the same sessions always
// yield the same plan, and the server keeps the last word on data it has just read. A
// co-organizer who changed something in between makes the applied count differ from the
// previewed one, which is why both actions return counts rather than assuming.

import type { AutoScheduleSkip } from '@/features/agenda/auto-schedule'
import { planAutoSchedule } from '@/features/agenda/auto-schedule'
import { getAgendaData } from '@/features/agenda/read-model'
import type { UnresolvedConflict } from '@/features/agenda/resolve-conflicts'
import { planConflictResolution } from '@/features/agenda/resolve-conflicts'
import { applySchedule } from '@/features/agenda/schedule-write'
import { requireEventRole } from '@/features/auth/wiring'

/**
 * Fill the tray: give every unscheduled session a room and a time.
 *
 * The plan is computed HERE, from a fresh read, and not taken from the client. The
 * surface already holds an `AgendaData` and could have planned it there, but then the
 * server would be applying placements it had to re-validate one by one, off a snapshot
 * that may be minutes old. Recomputing costs one read on a button press, and the only
 * thing crossing the boundary is an event id.
 *
 * Applied one row at a time through the same writer a drag uses, so the calendar sequence
 * bump and the tag expiry are the writer's job rather than a second copy of it here.
 * `planAutoSchedule` never proposes an overlap, so nothing here re-runs conflict detection.
 */
export async function autoScheduleAction(
  eventId: string,
): Promise<{ placed: number; skipped: readonly AutoScheduleSkip[]; queued: number }> {
  await requireEventRole(eventId, 'admin')
  const data = await getAgendaData(eventId)
  const plan = planAutoSchedule(data)

  let queued = 0
  for (const placement of plan.placements) {
    const result = await applySchedule({
      eventId,
      submissionId: placement.submissionId,
      roomId: placement.roomId,
      startsAt: placement.startsAt,
      endsAt: placement.endsAt,
      // Never `published`. A session an organizer has not looked at must not reach the
      // public agenda because a button placed it.
      scheduleStatus: 'scheduled',
    })
    queued += result.queued
  }

  // `queued` is reported because placing twelve sessions and telling nobody is a different
  // outcome from placing twelve and inviting their speakers, and the count is the only
  // thing that distinguishes them before the next cron sweep runs.
  return { placed: plan.placements.length, skipped: plan.skipped, queued }
}

/**
 * Move every double-booked session somewhere it is not. The Conflicts tab's button.
 *
 * THE STATUS IS PRESERVED PER SESSION, and that is the line worth reading twice. Unlike
 * auto-schedule, which places sessions nobody has looked at and so writes `scheduled`
 * unconditionally, this moves sessions that are already on the grid and may already be
 * PUBLISHED. Forcing `scheduled` here would quietly pull a live session off the public
 * agenda as a side effect of tidying a clash, and forcing `published` would push an
 * unreviewed one onto it. So each row keeps what it held, exactly as a drag does.
 *
 * `applySchedule` is the same writer the drag-and-drop grid uses, so a relocation goes
 * through the identical path and queues the calendar update that a speaker holding an
 * invite for the old slot needs. `queued` is reported because moving nine sessions and
 * telling nobody is a different outcome from moving nine and re-inviting their speakers.
 */
export async function autoResolveConflictsAction(eventId: string): Promise<{
  moved: number
  unresolved: readonly UnresolvedConflict[]
  queued: number
}> {
  await requireEventRole(eventId, 'admin')
  const data = await getAgendaData(eventId)
  const plan = planConflictResolution(data)

  const statusById = new Map(data.sessions.map((session) => [session.id, session.scheduleStatus]))

  let queued = 0
  for (const move of plan.moves) {
    const result = await applySchedule({
      eventId,
      submissionId: move.submissionId,
      roomId: move.roomId,
      startsAt: move.startsAt,
      endsAt: move.endsAt,
      scheduleStatus: statusById.get(move.submissionId) === 'published' ? 'published' : 'scheduled',
    })
    queued += result.queued
  }

  return { moved: plan.moves.length, unresolved: plan.unresolved, queued }
}
