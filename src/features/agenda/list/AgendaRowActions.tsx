'use client'

import { ClockIcon, ExternalLinkIcon, MoreHorizontalIcon } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import type { AgendaRoom, AgendaSession, ScheduleRequest } from '../types'
import { EditSessionSheet } from './EditSessionSheet'

export function AgendaRowActions({
  eventId,
  session,
  rooms,
  timeZone,
  isPending,
  onSchedule,
  onPublication,
}: {
  eventId: string
  session: AgendaSession
  rooms: readonly AgendaRoom[]
  timeZone: string
  isPending: boolean
  onSchedule: (change: ScheduleRequest) => void
  onPublication: (submissionIds: readonly string[], published: boolean) => void
}) {
  // Controlled rather than trigger-driven, for the reason DeleteResourceDialog gives: a
  // trigger nested in a menu item has the menu's dismissal fighting the sheet's focus trap.
  const [editing, setEditing] = useState(false)

  return (
    <>
      <DropdownMenu>
        {/* `hit-area-[36px]` and not `hit-area`: the kebab is 28x28, and on the table's
            COMPACT density the actions cell is `py-1`, so one row is 28 + 4 + 4 = 36px and
            the kebab above it sits 36px away. A 40px area would cross into the neighbouring
            row's, and a press landing on whichever won the stacking order is worse than a
            small target. 36 is the pitch, so the two areas meet exactly. */}
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" className="hit-area-[36px]" />}
        >
          <MoreHorizontalIcon />
          <span className="sr-only">Session actions</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            nativeButton={false}
            render={<Link href={`/admin/${eventId}/abstracts/${session.id}`} />}
          >
            <ExternalLinkIcon />
            Open session
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isPending} onClick={() => setEditing(true)}>
            <ClockIcon />
            Edit time &amp; room
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={isPending || session.scheduleStatus !== 'scheduled'}
            onClick={() => onPublication([session.id], true)}
          >
            Publish
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isPending || session.scheduleStatus !== 'published'}
            onClick={() => onPublication([session.id], false)}
          >
            Unpublish
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isPending || session.scheduleStatus === 'unscheduled'}
            onClick={() => onSchedule({ submissionId: session.id })}
          >
            Move to unscheduled tray
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editing ? (
        <EditSessionSheet
          session={session}
          rooms={rooms}
          timeZone={timeZone}
          open={editing}
          isPending={isPending}
          onOpenChange={setEditing}
          onSchedule={onSchedule}
        />
      ) : null}
    </>
  )
}
