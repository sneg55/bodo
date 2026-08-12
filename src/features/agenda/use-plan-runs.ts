'use client'

// Running the agenda's two BULK planner actions, and reporting honestly what each did.
//
// Split out of `AgendaSurface` at its line budget, and these two were the right pair to
// take: unlike every other write on that surface, neither touches the optimistic session
// list. They cannot, because neither knows which sessions it will affect until the server
// has re-planned, so both simply call and then say what came back. That leaves the surface
// owning state and these owning the reporting.
//
// The reporting is the substance here. Each action can half-succeed - place nine and leave
// three in the tray, move eight and fail to move two - and the failure half is the half an
// organizer has to act on. So a partial result is a WARNING and not a success: a toast
// reading "Moved 8 sessions" over a Conflicts tab still showing 2 is how somebody walks away
// from a job that is not done.

import type { TransitionStartFunction } from 'react'
import { toast } from 'sonner'

import { autoResolveConflictsAction, autoScheduleAction } from '@/features/agenda/plan-actions'

/**
 * The surface's own `startTransition`, injected rather than started here.
 *
 * One transition for the whole surface is the point: `isPending` is what disables every
 * write control while any of them is in flight, and a hook with a transition of its own
 * would leave the rest of the toolbar live during a bulk move.
 */
export function usePlanRuns(eventId: string, startTransition: TransitionStartFunction) {
  const autoSchedule = () => {
    startTransition(async () => {
      try {
        const { placed, skipped } = await autoScheduleAction(eventId)
        if (placed === 0 && skipped.length === 0) {
          toast.info('Nothing to schedule: the tray is empty.')
          return
        }
        // The skipped ones carry the reason the planner refused, and it is the useful
        // half: "no rooms yet" and "no free slot" want different things from the
        // organizer. Only the first is named, because a toast is not a report and the
        // reason is the same for the rest of a full day.
        if (skipped.length > 0) {
          toast.warning(
            `Scheduled ${String(placed)}. ${String(skipped.length)} left in the tray: ${skipped[0].reason}.`,
          )
          return
        }
        toast.success(`Scheduled ${String(placed)} ${placed === 1 ? 'session' : 'sessions'}.`)
      } catch {
        toast.error('The sessions could not be scheduled.')
      }
    })
  }

  const autoResolveConflicts = () => {
    startTransition(async () => {
      try {
        const { moved, unresolved } = await autoResolveConflictsAction(eventId)
        if (moved === 0 && unresolved.length === 0) {
          toast.info('Nothing to resolve: the agenda has no conflicts.')
          return
        }
        if (unresolved.length > 0) {
          toast.warning(
            `Moved ${String(moved)}. ${String(unresolved.length)} could not be moved: ${unresolved[0].reason}.`,
          )
          return
        }
        toast.success(`Moved ${String(moved)} ${moved === 1 ? 'session' : 'sessions'}.`)
      } catch {
        toast.error('The conflicts could not be resolved.')
      }
    })
  }

  return { autoSchedule, autoResolveConflicts }
}
