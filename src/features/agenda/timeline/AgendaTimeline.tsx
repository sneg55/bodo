'use client'

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import type { ConflictReport } from '../conflicts'
import { addMinutes, durationMinutes, formatAgendaDate } from '../time'
import type { AgendaData, AgendaFocus, ScheduleRequest } from '../types'
import { TimelineGrid } from './TimelineGrid'
import {
  parseCellId,
  parseDragId,
  SLOT_HEIGHT,
  SLOT_MINUTES,
  scheduleAtCell,
  type TimelineMode,
  timelineDates,
  timelineLanes,
} from './timeline-model'
import { UnscheduledTray } from './UnscheduledTray'

export function AgendaTimeline({
  mode,
  data,
  report,
  isPending,
  focus,
  onSchedule,
}: {
  mode: TimelineMode
  data: AgendaData
  report: ConflictReport
  isPending: boolean
  /** Set when the organizer arrived from a conflict card, so the grid opens on that session. */
  focus?: AgendaFocus | null
  onSchedule: (change: ScheduleRequest) => void
}) {
  const dates = timelineDates(data)
  // Only as the INITIAL selection: the timeline unmounts whenever the tab strip leaves the
  // three grid views, so a later focus arrives as a fresh mount and the organizer's own
  // pick of day or room is never overwritten under them.
  // A session can sit on a day the event's own dates do not cover, and the date Select only
  // offers those, so an unknown focus day is ignored rather than shown as an empty picker.
  const hasFocusDay = focus !== null && focus !== undefined && dates.includes(focus.dateKey)
  const [selectedDate, setSelectedDate] = useState<string | null>(
    (hasFocusDay ? focus.dateKey : undefined) ?? dates.at(0) ?? null,
  )
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(
    data.rooms.find((room) => room.id === focus?.roomId)?.id ?? data.rooms.at(0)?.id ?? null,
  )
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )
  const lanes =
    selectedDate === null || selectedRoomId === null
      ? []
      : timelineLanes(data, mode, selectedDate, selectedRoomId)
  const unscheduled = data.sessions.filter((session) => session.scheduleStatus === 'unscheduled')

  if (dates.length === 0 || data.rooms.length === 0) {
    return (
      <Card>
        <CardContent className="flex min-h-72 items-center justify-center text-center text-muted-foreground">
          Add event dates and at least one room to start scheduling.
        </CardContent>
      </Card>
    )
  }

  const endDrag = (event: DragEndEvent) => {
    const drag = parseDragId(String(event.active.id))
    if (drag === undefined) return
    const session = data.sessions.find((candidate) => candidate.id === drag.sessionId)
    if (session === undefined) return
    if (drag.kind === 'resize') {
      resizeSession(session, event.delta.y, onSchedule)
      return
    }
    if (event.over === null) return
    const cell = parseCellId(String(event.over.id))
    if (cell === undefined) return
    const change = scheduleAtCell(session, cell, data.event.timezone)
    if (change !== undefined) onSchedule(change)
  }

  return (
    <DndContext sensors={sensors} onDragEnd={endDrag}>
      <div className="flex flex-col gap-3">
        <TimelineControls
          mode={mode}
          dates={dates}
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          rooms={data.rooms}
          selectedRoomId={selectedRoomId}
          onRoomChange={setSelectedRoomId}
        />
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <TimelineGrid
            sessions={data.sessions}
            lanes={lanes}
            timeZone={data.event.timezone}
            report={report}
            disabled={isPending}
            focusedSessionId={focus?.sessionId}
          />
          <UnscheduledTray sessions={unscheduled} report={report} disabled={isPending} />
        </div>
      </div>
    </DndContext>
  )
}

/**
 * "Tue, May 12, 2027", for the day picker.
 *
 * Named because it is used twice and has to agree with itself: once for the option and once
 * for the `items` map the closed trigger reads from. Two copies of the same options object
 * is exactly how the trigger and the list came to disagree everywhere else.
 */
function dayLabel(date: string): string {
  return formatAgendaDate(date, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function TimelineControls({
  mode,
  dates,
  selectedDate,
  onDateChange,
  rooms,
  selectedRoomId,
  onRoomChange,
}: {
  mode: TimelineMode
  dates: readonly string[]
  selectedDate: string | null
  onDateChange: (date: string | null) => void
  rooms: AgendaData['rooms']
  selectedRoomId: string | null
  onRoomChange: (roomId: string | null) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {mode === 'week' ? (
        <Select
          // Room values are RECORD IDS, so without this the closed trigger read
          // `recRoom123` while the open list read "Hall A".
          items={Object.fromEntries(rooms.map((room) => [room.id, room.name]))}
          value={selectedRoomId}
          onValueChange={onRoomChange}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select room" />
          </SelectTrigger>
          <SelectContent>
            {rooms.map((room) => (
              <SelectItem key={room.id} value={room.id}>
                {room.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Select
          // Same again: the value is the ISO date, so the trigger read `2027-05-12`.
          items={Object.fromEntries(dates.map((date) => [date, dayLabel(date)]))}
          value={selectedDate}
          onValueChange={onDateChange}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select date" />
          </SelectTrigger>
          <SelectContent>
            {dates.map((date) => (
              <SelectItem key={date} value={date}>
                {dayLabel(date)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <p className="text-sm text-muted-foreground">
        {mode === 'week'
          ? 'Days are columns. Choose the room to schedule.'
          : mode === 'rooms'
            ? 'Rooms are columns for the selected day.'
            : 'Drag sessions between room columns or resize from the lower handle.'}
      </p>
    </div>
  )
}

function resizeSession(
  session: AgendaData['sessions'][number],
  deltaY: number,
  onSchedule: (change: ScheduleRequest) => void,
): void {
  if (session.roomId === undefined || session.startsAt === undefined) return
  const stepChange = Math.round(deltaY / SLOT_HEIGHT) * SLOT_MINUTES
  const nextDuration = Math.max(SLOT_MINUTES, durationMinutes(session) + stepChange)
  onSchedule({
    submissionId: session.id,
    roomId: session.roomId,
    startsAt: session.startsAt,
    endsAt: addMinutes(session.startsAt, nextDuration),
  })
}
