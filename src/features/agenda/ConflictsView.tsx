'use client'

// The Conflicts tab: the pairs `conflicts.ts` found, and a way out of each one.
//
// It used to be a wall of read-only cards. It named two sessions and stopped there, so an
// organizer who agreed with the finding had to remember both titles, switch to Day view,
// find the right day and room by hand, and only then could move anything. Every card now
// carries both halves of the pair as its own row: the title opens the session record, and
// "Show in Day view" puts the grid on that session's day and room with the card ringed,
// which is where a conflict is actually resolved by dragging.

import { AlertTriangleIcon, CalendarDaysIcon, ExternalLinkIcon } from 'lucide-react'
import Link from 'next/link'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import type { ConflictReport } from './conflicts'
import { dateKeyAt, formatAgendaDate, formatMinutes, minutesAt } from './time'
import type { AgendaData, AgendaFocus, AgendaSession } from './types'

export function ConflictsView({
  data,
  report,
  onFocus,
}: {
  data: AgendaData
  report: ConflictReport
  /** Switches the surface to Day view on that session. */
  onFocus: (focus: AgendaFocus) => void
}) {
  if (report.count === 0) {
    return (
      <Card>
        <CardContent className="flex min-h-72 flex-col items-center justify-center gap-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <AlertTriangleIcon className="size-5" />
          </div>
          <p className="font-medium">No scheduling conflicts</p>
          <p className="text-pretty text-sm text-muted-foreground">
            Room and participant overlaps will appear here.
          </p>
        </CardContent>
      </Card>
    )
  }
  const sessionById = new Map(data.sessions.map((session) => [session.id, session]))
  const roomById = new Map(data.rooms.map((room) => [room.id, room.name]))
  const speakerById = new Map(data.speakers.map((speaker) => [speaker.id, speaker.name]))

  return (
    <div className="grid gap-3">
      {report.conflicts.map((conflict) => {
        const first = sessionById.get(conflict.aId)
        const second = sessionById.get(conflict.bId)
        return (
          <Card key={`${conflict.kind}:${conflict.aId}:${conflict.bId}`} size="sm">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="destructive">
                  <AlertTriangleIcon />
                  {conflict.kind === 'room' ? 'Room conflict' : 'Participant conflict'}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {conflict.kind === 'room'
                    ? roomById.get(conflict.roomId ?? '')
                    : speakerById.get(conflict.speakerId ?? '')}
                </span>
              </div>
              <CardTitle className="text-balance">
                {first?.title ?? conflict.aId} and {second?.title ?? conflict.bId}
              </CardTitle>
              <CardDescription>{conflict.reason}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {[first, second]
                .filter((session): session is AgendaSession => session !== undefined)
                .map((session) => (
                  <ConflictSessionRow
                    key={session.id}
                    eventId={data.event.id}
                    session={session}
                    roomName={
                      session.roomId === undefined ? undefined : roomById.get(session.roomId)
                    }
                    timeZone={data.event.timezone}
                    onFocus={onFocus}
                  />
                ))}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function ConflictSessionRow({
  eventId,
  session,
  roomName,
  timeZone,
  onFocus,
}: {
  eventId: string
  session: AgendaSession
  roomName: string | undefined
  timeZone: string
  onFocus: (focus: AgendaFocus) => void
}) {
  const dateKey = session.startsAt === undefined ? undefined : dateKeyAt(session.startsAt, timeZone)
  const focus =
    dateKey === undefined || session.roomId === undefined
      ? undefined
      : { sessionId: session.id, dateKey, roomId: session.roomId }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2">
      <div className="flex min-w-0 flex-col">
        <ButtonLink
          href={`/admin/${eventId}/abstracts/${session.id}`}
          variant="link"
          size="sm"
          // `plain-label`: the label IS the session title, text the speaker typed. The
          // mono-uppercase button treatment is for commands, and it rendered a talk called
          // "Scaling Postgres to a billion rows" as machine chrome next to the same title
          // set in sentence case on every other agenda surface.
          // `hit-area-y`: `h-auto p-0` on a `sm` link leaves a 20px-tall target, and the
          // title is the only route from a conflict card into the session record. It is
          // already the full width of its column, so the area grows on the short axis
          // only. The nearest interactive element above is the previous card row's own
          // title, 40px away (16px summary line + 8px card padding + 8px row gap + 8px
          // padding), and the two areas take 10px each from that.
          className="plain-label h-auto justify-start p-0 text-left hit-area-y"
        >
          <span className="truncate">{session.title}</span>
          <ExternalLinkIcon />
        </ButtonLink>
        {/* `tabular-nums`: two of these stack inside every conflict card, and the pair is
            read as a comparison of clock times. Proportional digits misalign the columns. */}
        <p className="text-xs text-muted-foreground tabular-nums">
          {slotSummary(session, roomName, timeZone)}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        // `hit-area-y`: `sm` is `h-7`, so this is 28px tall and already wide enough. The
        // row it centres in is 52px (36px of stacked title and summary plus `p-2`), and
        // the next row's button is 60px away, so 40px of height clears it by 20px. The
        // title link to its left keeps its own width, so the two never meet sideways.
        className="hit-area-y"
        disabled={focus === undefined}
        onClick={() => {
          if (focus !== undefined) onFocus(focus)
        }}
      >
        <CalendarDaysIcon data-icon="inline-start" />
        Show in Day view
      </Button>
    </div>
  )
}

/** `Main Stage · Mon, Oct 12 · 9:00 AM - 10:00 AM`, or as much of it as is known. */
function slotSummary(
  session: AgendaSession,
  roomName: string | undefined,
  timeZone: string,
): string {
  const dateKey = session.startsAt === undefined ? undefined : dateKeyAt(session.startsAt, timeZone)
  const startMinute =
    session.startsAt === undefined ? undefined : minutesAt(session.startsAt, timeZone)
  const endMinute = session.endsAt === undefined ? undefined : minutesAt(session.endsAt, timeZone)
  const times =
    startMinute === undefined
      ? undefined
      : endMinute === undefined
        ? formatMinutes(startMinute)
        : `${formatMinutes(startMinute)} - ${formatMinutes(endMinute)}`

  return [
    roomName,
    dateKey === undefined
      ? undefined
      : formatAgendaDate(dateKey, { weekday: 'short', month: 'short', day: 'numeric' }),
    times,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ')
}
