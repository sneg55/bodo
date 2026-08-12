'use client'

// Auto-schedule, with the plan shown before it is written.
//
// The button used to bulk-write the whole tray on one click and report afterwards in a
// toast. That is the wrong order for a write this wide: it touches every unscheduled
// session at once, there is no undo, and until the toast landed nothing on screen said how
// many rows had moved or where. So the plan is computed here first, from the same pure
// `planAutoSchedule` the server action runs, and the organizer confirms an actual list of
// placements.
//
// The preview is planned on the CLIENT and the write still re-plans on the SERVER, off a
// fresh read (see `autoScheduleAction`). That is deliberate rather than duplicated work:
// the planner is pure and deterministic, so the same sessions always yield the same plan,
// and the server keeps the last word on data it has just read. If a co-organizer changed
// something in between, the confirmed count can differ from the applied one, which is why
// the action's own toast still reports what actually happened.

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

import type { AutoSchedulePlan } from './auto-schedule'
import { planAutoSchedule } from './auto-schedule'
import { dateKeyAt, formatAgendaDate, formatMinutes, minutesAt } from './time'
import type { AgendaData } from './types'

const EMPTY_PLAN: AutoSchedulePlan = { placements: [], skipped: [] }

export function AutoScheduleDialog({
  data,
  disabled,
  onConfirm,
}: {
  data: AgendaData
  disabled: boolean
  onConfirm: () => void
}) {
  const [open, setOpen] = useState(false)
  // Planned only while the dialog is up, which is also why it is not memoised: the surface
  // hands down a fresh object every render (the optimistic session list is spread into it),
  // so a memo would never hit, and the planner is a pure sweep over the tray.
  const plan = open ? planAutoSchedule(data) : EMPTY_PLAN
  const unscheduledCount = data.sessions.filter(
    (session) => session.scheduleStatus === 'unscheduled',
  ).length
  const sessionById = new Map(data.sessions.map((session) => [session.id, session]))
  const roomById = new Map(data.rooms.map((room) => [room.id, room.name]))

  return (
    <>
      {/* Disabled rather than hidden when the tray is empty, so the capability is
          discoverable before it is needed. The count is in the label rather than in a
          badge: a badge next to a verb reads as a filter tab, and this is a write. */}
      <Button
        variant="outline"
        disabled={disabled || unscheduledCount === 0}
        onClick={() => setOpen(true)}
      >
        <WandSparklesIcon data-icon="inline-start" />
        {unscheduledCount === 0
          ? 'Auto-schedule'
          : `Auto-schedule ${String(unscheduledCount)} ${unscheduledCount === 1 ? 'session' : 'sessions'}`}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="sm:max-w-lg!">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {plan.placements.length === 0
                ? 'Nothing can be placed'
                : `Place ${String(plan.placements.length)} ${plan.placements.length === 1 ? 'session' : 'sessions'}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {plan.placements.length === 0
                ? 'No session in the tray has a free slot. Nothing will be written.'
                : 'These sessions move out of the tray into the rooms and times below. They stay unpublished until you publish them, and this is not undoable in one step.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <ScrollPanel className="max-h-64 w-full">
            <ul className="grid gap-1.5 pr-3 text-sm">
              {plan.placements.map((placement) => (
                <li key={placement.submissionId} className="flex flex-col">
                  <span className="truncate font-medium">
                    {sessionById.get(placement.submissionId)?.title ?? placement.submissionId}
                  </span>
                  {/* `tabular-nums`: the plan is a stacked list of proposed slots, read
                      down the column to check nothing lands on the same clock time. */}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {[
                      roomById.get(placement.roomId) ?? 'Room',
                      formatSlot(placement.startsAt, data.event.timezone),
                    ].join(' · ')}
                  </span>
                </li>
              ))}
              {plan.skipped.map((skip) => (
                <li key={skip.submissionId} className="flex flex-col">
                  <span className="truncate font-medium text-muted-foreground line-through">
                    {skip.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Stays in the tray: {skip.reason}
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
                  disabled={disabled || plan.placements.length === 0}
                  onClick={() => {
                    setOpen(false)
                    onConfirm()
                  }}
                />
              }
            >
              Schedule{' '}
              {plan.placements.length === 1
                ? '1 session'
                : `${String(plan.placements.length)} sessions`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** `Mon, Oct 12 · 9:00 AM`, the two facts an organizer checks a proposed slot against. */
function formatSlot(startsAt: string, timeZone: string): string {
  const dateKey = dateKeyAt(startsAt, timeZone)
  const minute = minutesAt(startsAt, timeZone)
  if (dateKey === undefined || minute === undefined) return startsAt
  return `${formatAgendaDate(dateKey, { weekday: 'short', month: 'short', day: 'numeric' })} · ${formatMinutes(minute)}`
}
