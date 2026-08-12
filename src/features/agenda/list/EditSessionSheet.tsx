'use client'

// Change a session's room and time from the List view.
//
// The row kebab offered Publish, Unpublish and "Move to unscheduled tray", so the only way
// to give a session a slot, or to correct one, was to drag it on the Day, Week or Rooms
// grid. That is fine for building a day and useless for fixing one row: the List view is
// where an organizer works from a spreadsheet or an email, and it could read Starts At and
// Ends At without being able to change either.
//
// It writes through the same `onSchedule` a drag does, so the optimistic update, the
// server-side validation and the tag expiry are all the one path.
//
// It also UNSCHEDULES, and that button is here because the sheet is where an organizer
// looks for it. "Move to unscheduled tray" has always existed on the row kebab, one item
// below the one that opens this sheet, and a reviewer of the shipped product still recorded
// that "a scheduled session cannot be returned to the Unscheduled tray from the scheduling
// UI the app offers for it": once the sheet is open the menu is gone, the four fields are
// Room, Date, Starts at and Duration, and every one of them can only MOVE the session. A
// control that exists on a surface nobody reaches it from is a control that does not exist.

import { useState } from 'react'

import { DateKeyField } from '@/components/primitives/DateKeyField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

import { addMinutes, dateKeyAt, durationMinutes, minutesAt, zonedDateTimeToIso } from '../time'
import type { AgendaRoom, AgendaSession, ScheduleRequest } from '../types'

export function EditSessionSheet({
  session,
  rooms,
  timeZone,
  open,
  isPending,
  onOpenChange,
  onSchedule,
}: {
  session: AgendaSession
  rooms: readonly AgendaRoom[]
  timeZone: string
  open: boolean
  isPending: boolean
  onOpenChange: (open: boolean) => void
  onSchedule: (change: ScheduleRequest) => void
}) {
  // Seeded from the session and reset by remounting: the caller keys this on the row, so a
  // sheet opened after a change starts from what is stored rather than from the last edit.
  const [roomId, setRoomId] = useState<string | null>(session.roomId ?? rooms.at(0)?.id ?? null)
  const [date, setDate] = useState(
    session.startsAt === undefined ? '' : (dateKeyAt(session.startsAt, timeZone) ?? ''),
  )
  const [time, setTime] = useState(clockValue(session, timeZone))
  const [duration, setDuration] = useState(String(durationMinutes(session)))

  const minutes = parseMinutes(time)
  const length = Number(duration)
  const startsAt =
    roomId === null || date === '' || minutes === undefined
      ? undefined
      : zonedDateTimeToIso(date, minutes, timeZone)
  const valid = startsAt !== undefined && Number.isFinite(length) && length > 0

  const save = () => {
    if (!valid || roomId === null) return
    onSchedule({
      submissionId: session.id,
      roomId,
      startsAt,
      endsAt: addMinutes(startsAt, length),
    })
    onOpenChange(false)
  }

  // A `ScheduleRequest` with NO room is what the write layer reads as "unschedule": the
  // reducer in ../optimistic.ts maps an absent `roomId` to `scheduleStatus: 'unscheduled'`
  // and `scheduleFields` clears the room and both times. Exactly what the row kebab's "Move
  // to unscheduled tray" sends, so this is the same one path and not a second way to clear.
  const unschedule = () => {
    onSchedule({ submissionId: session.id })
    onOpenChange(false)
  }

  const scheduled = session.scheduleStatus !== 'unscheduled'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md!">
        <SheetHeader>
          <SheetTitle>Edit time &amp; room</SheetTitle>
          <SheetDescription>{session.title}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agenda-edit-room">Room</Label>
            <Select
              // Room ids are what this Select stores, and Base UI prints the stored value
              // on the CLOSED trigger unless it is handed the label for it. Without this
              // map, reopening the sheet on a scheduled session reads `recXXXXXXXXXXXXXX`
              // where the room name belongs. Same fix, same reason, as the speaker Select
              // in AddSessionSheet.
              items={Object.fromEntries(rooms.map((room) => [room.id, room.name]))}
              value={roomId}
              onValueChange={setRoomId}
              disabled={rooms.length === 0}
            >
              <SelectTrigger id="agenda-edit-room" className="w-full">
                <SelectValue placeholder="Select a room" />
              </SelectTrigger>
              <SelectContent>
                {rooms.map((room) => (
                  <SelectItem key={room.id} value={room.id}>
                    {room.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {rooms.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Add a room at Settings &gt; Library &gt; Tags before scheduling.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agenda-edit-date">Date</Label>
            {/* `Calendar` inside `Popover`, not a native date input: the native picker
                dismissed the surrounding Sheet, losing the room and time set alongside it.
                Not clearable, because a scheduled session must have a day: the footer's
                Move to unscheduled tray is the way to remove it, and that clears the room
                and both times in the same write. */}
            <DateKeyField
              id="agenda-edit-date"
              value={date}
              onChange={setDate}
              emptyLabel="Pick a date"
              clearable={false}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agenda-edit-time">Starts at</Label>
            <Input
              id="agenda-edit-time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">Local time in {timeZone}.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agenda-edit-duration">Duration (minutes)</Label>
            <Input
              id="agenda-edit-duration"
              type="number"
              min={5}
              step={5}
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </div>

          <SheetFooter className="mt-auto flex-row items-center px-0">
            {/* Left of the divider between "put this somewhere else" and "put it nowhere",
                and hidden rather than disabled on a session that is already in the tray,
                per the project's dead-controls rule: there is nothing to clear. */}
            {scheduled ? (
              <Button
                type="button"
                variant="ghost"
                disabled={isPending}
                className="mr-auto"
                onClick={unschedule}
              >
                Move to unscheduled tray
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={isPending || !valid} onClick={save}>
              Save
            </Button>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** `HH:MM` for the time input, which will not accept anything else. */
function clockValue(session: AgendaSession, timeZone: string): string {
  const minute = session.startsAt === undefined ? undefined : minutesAt(session.startsAt, timeZone)
  if (minute === undefined) return ''
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

function parseMinutes(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/u.exec(value)
  if (match === null) return undefined
  const [, hour = '', minute = ''] = match
  const minutes = Number(hour) * 60 + Number(minute)
  return minutes >= 0 && minutes < 24 * 60 ? minutes : undefined
}
