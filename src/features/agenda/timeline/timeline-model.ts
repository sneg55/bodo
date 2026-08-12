import {
  addMinutes,
  dateKeyAt,
  durationMinutes,
  eventDateKeys,
  formatAgendaDate,
  minutesAt,
  zonedDateTimeToIso,
} from '../time'
import type { AgendaData, AgendaSession } from '../types'

export const SLOT_MINUTES = 15
export const SLOT_HEIGHT = 32
export const START_MINUTE = 8 * 60
export const END_MINUTE = 18 * 60

export type TimelineMode = 'day' | 'week' | 'rooms'

export type TimelineLane = {
  id: string
  label: string
  detail?: string
  roomId: string
  dateKey: string
}

export type TimelinePosition = {
  laneIndex: number
  rowStart: number
  rowSpan: number
}

export type TimelinePlacement = TimelinePosition & {
  /** Zero-based column inside the lane. */
  column: number
  /** How many columns the lane is split into around this session. Always at least 1. */
  columns: number
}

export function timelineDates(data: AgendaData): readonly string[] {
  return eventDateKeys(data.event.startsAt, data.event.endsAt, data.event.timezone)
}

export function timelineLanes(
  data: AgendaData,
  mode: TimelineMode,
  selectedDate: string,
  selectedRoomId: string,
): readonly TimelineLane[] {
  if (mode === 'week') {
    const room = data.rooms.find((candidate) => candidate.id === selectedRoomId)
    if (room === undefined) return []
    return timelineDates(data).map((date) => ({
      id: `day:${date}`,
      label: formatAgendaDate(date, { weekday: 'short' }),
      detail: room.name,
      roomId: room.id,
      dateKey: date,
    }))
  }
  return data.rooms.map((room) => ({
    id: `room:${room.id}`,
    label: room.name,
    detail: room.capacity === undefined ? undefined : `Capacity ${room.capacity}`,
    roomId: room.id,
    dateKey: selectedDate,
  }))
}

export function timelineSlots(): readonly number[] {
  const count = (END_MINUTE - START_MINUTE) / SLOT_MINUTES
  return Array.from({ length: count }, (_, index) => START_MINUTE + index * SLOT_MINUTES)
}

export function timelinePosition(
  session: AgendaSession,
  lanes: readonly TimelineLane[],
  timeZone: string,
): TimelinePosition | undefined {
  if (session.roomId === undefined || session.startsAt === undefined) return undefined
  const date = dateKeyAt(session.startsAt, timeZone)
  const minute = minutesAt(session.startsAt, timeZone)
  if (date === undefined || minute === undefined || minute < START_MINUTE || minute >= END_MINUTE) {
    return undefined
  }
  const laneIndex = lanes.findIndex(
    (lane) => lane.roomId === session.roomId && lane.dateKey === date,
  )
  if (laneIndex < 0) return undefined
  const rowStart = Math.floor((minute - START_MINUTE) / SLOT_MINUTES) + 1
  const rowSpan = Math.max(1, Math.ceil(durationMinutes(session) / SLOT_MINUTES))
  return { laneIndex, rowStart, rowSpan }
}

/**
 * Where every session sits on the grid, with overlapping ones placed side by side.
 *
 * Two sessions in one room at one time is a state the organizer is allowed to create:
 * conflicts.ts reports it, it never blocks it. So the grid has to draw it. Position alone
 * puts both cards in the same cell, and the later one covers the earlier one down to its
 * last line, which hides exactly the pair the Conflicts tab is pointing at. Overlapping
 * sessions are packed into columns within their lane instead: each keeps its full height
 * and takes a share of the width, so no card is hidden behind another.
 */
export function timelineLayout(
  sessions: readonly AgendaSession[],
  lanes: readonly TimelineLane[],
  timeZone: string,
): ReadonlyMap<string, TimelinePlacement> {
  const byLane = new Map<number, LaneEntry[]>()
  for (const session of sessions) {
    const position = timelinePosition(session, lanes, timeZone)
    if (position === undefined) continue
    const entry = { id: session.id, position }
    const existing = byLane.get(position.laneIndex)
    if (existing === undefined) {
      byLane.set(position.laneIndex, [entry])
    } else {
      existing.push(entry)
    }
  }

  const placements = new Map<string, TimelinePlacement>()
  for (const entries of byLane.values()) {
    for (const [id, placement] of packLane(entries)) {
      placements.set(id, placement)
    }
  }
  return placements
}

type LaneEntry = { id: string; position: TimelinePosition }

/**
 * The usual calendar packing, one lane at a time: sessions are swept in start order and
 * each takes the leftmost column that is free at its start row. A run of sessions that
 * overlaps transitively counts as one cluster and every card in it is cut to the same
 * width, so a pair does not change size depending on which half is read first. Ties break
 * on span then id, which keeps the output stable across renders.
 */
function packLane(entries: readonly LaneEntry[]): Map<string, TimelinePlacement> {
  const sorted = [...entries].sort(
    (left, right) =>
      left.position.rowStart - right.position.rowStart ||
      right.position.rowSpan - left.position.rowSpan ||
      compareIds(left.id, right.id),
  )
  const packed = new Map<string, TimelinePlacement>()
  let cluster: string[] = []
  let columnEnds: number[] = []
  let clusterEnd = 0

  // The column count is only known once the cluster is closed, so members are written with
  // a placeholder and widened here.
  const closeCluster = () => {
    for (const id of cluster) {
      const placement = packed.get(id)
      if (placement !== undefined) packed.set(id, { ...placement, columns: columnEnds.length })
    }
    cluster = []
    columnEnds = []
    clusterEnd = 0
  }

  for (const entry of sorted) {
    if (cluster.length > 0 && entry.position.rowStart >= clusterEnd) closeCluster()
    const rowEnd = entry.position.rowStart + entry.position.rowSpan
    const free = columnEnds.findIndex((columnEnd) => columnEnd <= entry.position.rowStart)
    if (free < 0) {
      columnEnds.push(rowEnd)
    } else {
      columnEnds.splice(free, 1, rowEnd)
    }
    const column = free < 0 ? columnEnds.length - 1 : free
    clusterEnd = Math.max(clusterEnd, rowEnd)
    cluster.push(entry.id)
    packed.set(entry.id, { ...entry.position, column, columns: 1 })
  }
  closeCluster()

  return packed
}

function compareIds(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

export function cellId(lane: TimelineLane, minute: number): string {
  return `cell:${encodeURIComponent(lane.roomId)}:${lane.dateKey}:${minute}`
}

export function parseCellId(value: string) {
  const match = /^cell:([^:]+):(\d{4}-\d{2}-\d{2}):(\d+)$/u.exec(value)
  if (match === null) return undefined
  const [, encodedRoomId = '', dateKey = '', minuteValue = ''] = match
  const minute = Number(minuteValue)
  return Number.isFinite(minute)
    ? { roomId: decodeURIComponent(encodedRoomId), dateKey, minute }
    : undefined
}

export function moveId(sessionId: string): string {
  return `move:${encodeURIComponent(sessionId)}`
}

export function resizeId(sessionId: string): string {
  return `resize:${encodeURIComponent(sessionId)}`
}

export function parseDragId(
  value: string,
): { kind: 'move' | 'resize'; sessionId: string } | undefined {
  const match = /^(move|resize):(.+)$/u.exec(value)
  if (match === null) return undefined
  const [, kind = '', encodedSessionId = ''] = match
  if (kind !== 'move' && kind !== 'resize') return undefined
  return { kind, sessionId: decodeURIComponent(encodedSessionId) }
}

export function scheduleAtCell(
  session: AgendaSession,
  cell: { roomId: string; dateKey: string; minute: number },
  timeZone: string,
) {
  const startsAt = zonedDateTimeToIso(cell.dateKey, cell.minute, timeZone)
  if (startsAt === undefined) return undefined
  return {
    submissionId: session.id,
    roomId: cell.roomId,
    startsAt,
    endsAt: addMinutes(startsAt, durationMinutes(session)),
  }
}
