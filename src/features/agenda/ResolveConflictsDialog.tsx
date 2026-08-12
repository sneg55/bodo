'use client'

// Auto-resolve, with the moves shown before they are written.
//
// The sibling of `AutoScheduleDialog` and deliberately the same shape, because they are the
// same kind of act: a bulk schedule write with no undo. The preview matters MORE here. Every
// row auto-schedule touches is a session nobody has placed yet; every row this touches is one
// an organizer put somewhere on purpose, and a speaker may already be holding a calendar
// invite for the slot it is about to leave. So the dialog shows each move as a change,
// from-slot and to-slot on one line, rather than just naming a destination.
//
// It REPLACES the Auto-schedule button on the Conflicts tab rather than sitting beside it.
// Auto-schedule is about the tray and does nothing for an overlap; on the one tab whose whole
// subject is overlaps, a button that cannot touch them is the wrong offer.
//
// Planned on the CLIENT and re-planned on the SERVER, exactly as auto-schedule does it. The
// planner is pure and deterministic, so the same sessions always yield the same plan, and the
// server keeps the last word on data it has just read.

import { WandSparklesIcon } from 'lucide-react'
import { useState } from 'react'
import { ScrollPanel } from '@/components/primitives/ScrollPanel'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

import type { ConflictResolutionPlan } from './resolve-conflicts'
import { planConflictResolution } from './resolve-conflicts'
import { dateKeyAt, formatAgendaDate, formatMinutes, minutesAt } from './time'
import type { AgendaData } from './types'

const EMPTY_PLAN: ConflictResolutionPlan = { moves: [], unresolved: [], conflictCount: 0 }

export function ResolveConflictsDialog({
  data,
  conflictCount,
  disabled,
  onConfirm,
}: {
  data: AgendaData
  /** The tab's own count, so the closed button agrees with the badge next to it. */
  conflictCount: number
  disabled: boolean
  onConfirm: () => void
}) {
  const [open, setOpen] = useState(false)
  // Planned only while the dialog is up, and not memoised, for the reason the sibling gives:
  // the surface hands down a fresh object every render, so a memo would never hit.
  const plan = open ? planConflictResolution(data) : EMPTY_PLAN
  const sessionById = new Map(data.sessions.map((session) => [session.id, session]))
  const roomById = new Map(data.rooms.map((room) => [room.id, room.name]))
  const slotLabel = (roomId: string, startsAt: string) =>
    [roomById.get(roomId) ?? 'Room', formatSlot(startsAt, data.event.timezone)].join(' · ')

  return (
    <>
      {/* Disabled rather than hidden at zero, so the capability is discoverable before it is
          needed, and the count is in the label rather than a badge: a badge next to a verb
          reads as a filter tab, and this is a write. */}
      <Button
        variant="outline"
        disabled={disabled || conflictCount === 0}
        onClick={() => setOpen(true)}
      >
        <WandSparklesIcon data-icon="inline-start" />
        {conflictCount === 0
          ? 'Auto-resolve conflicts'
          : `Auto-resolve ${String(conflictCount)} ${conflictCount === 1 ? 'conflict' : 'conflicts'}`}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="sm:max-w-lg!">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {plan.moves.length === 0
                ? 'Nothing can be moved'
                : `Move ${String(plan.moves.length)} ${plan.moves.length === 1 ? 'session' : 'sessions'}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {plan.moves.length === 0
                ? 'No conflicting session has a free slot to move to. Nothing will be written.'
                : 'These sessions move to the rooms and times below. A published session stays published, speakers holding an invite for the old slot are sent an update, and this is not undoable in one step.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <ScrollPanel className="max-h-64 w-full">
            <ul className="grid gap-1.5 pr-3 text-sm">
              {plan.moves.map((move) => (
                <li key={move.submissionId} className="flex flex-col">
                  <span className="truncate font-medium">
                    {sessionById.get(move.submissionId)?.title ?? move.submissionId}
                  </span>
                  {/* Both ends of the change. A destination alone would not tell an
                      organizer what they are giving up. */}
                  {/* `tabular-nums`: this line is a from/to comparison of two clock times
                      on one row, and a stack of them down the panel. */}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {slotLabel(move.fromRoomId, move.fromStartsAt)} &rarr;{' '}
                    {slotLabel(move.roomId, move.startsAt)}
                  </span>
                </li>
              ))}
              {/* Named, never silently dropped. A resolver that reported "8 fixed" while
                  leaving two clashes standing would send an organizer away from a tab that
                  is still red. */}
              {plan.unresolved.map((entry) => (
                <li key={entry.submissionId} className="flex flex-col">
                  <span className="truncate font-medium text-muted-foreground">{entry.title}</span>
                  <span className="text-xs text-muted-foreground">
                    Stays where it is: {entry.reason}
                  </span>
                </li>
              ))}
            </ul>
          </ScrollPanel>

          <AlertDialogFooter>
            <AlertDialogCancel render={<Button variant="ghost" />}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              render={
                <Button
                  disabled={disabled || plan.moves.length === 0}
                  onClick={() => {
                    setOpen(false)
                    onConfirm()
                  }}
                />
              }
            >
              Move {plan.moves.length === 1 ? '1 session' : `${String(plan.moves.length)} sessions`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** `Mon, Oct 12 · 9:00 AM`, the two facts an organizer checks a slot against. */
function formatSlot(startsAt: string, timeZone: string): string {
  const dateKey = dateKeyAt(startsAt, timeZone)
  const minute = minutesAt(startsAt, timeZone)
  if (dateKey === undefined || minute === undefined) return startsAt
  return `${formatAgendaDate(dateKey, { weekday: 'short', month: 'short', day: 'numeric' })} · ${formatMinutes(minute)}`
}
