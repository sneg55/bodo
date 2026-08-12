import { CalendarDaysIcon } from 'lucide-react'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/utils/cn'
import { ConflictBadge } from './ConflictBadge'
import type { ConflictReport } from './conflicts'
import { dateKeyAt, formatAgendaDate, monthGridDateKeys } from './time'
import type { AgendaData } from './types'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export function MonthView({ data, report }: { data: AgendaData; report: ConflictReport }) {
  const anchor = monthAnchor(data)
  if (anchor === undefined) {
    return (
      <Card>
        <CardContent className="flex min-h-72 flex-col items-center justify-center gap-2 text-center">
          <CalendarDaysIcon className="size-8 text-muted-foreground" />
          <p className="font-medium">Event dates are not configured.</p>
        </CardContent>
      </Card>
    )
  }
  const dates = monthGridDateKeys(anchor)
  const anchorMonth = anchor.slice(0, 7)
  const sessionsByDate = groupSessions(data, dates)

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b py-4">
        <CardTitle>{formatAgendaDate(anchor, { month: 'long', year: 'numeric' })}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <div className="grid min-w-3xl grid-cols-7">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="border-b border-r border-border px-2 py-2 text-xs font-medium text-muted-foreground last:border-r-0"
            >
              {day}
            </div>
          ))}
          {dates.map((date) => (
            <div
              key={date}
              className={cn(
                'min-h-32 border-r border-b border-border p-2 last:border-r-0',
                date.startsWith(anchorMonth) ? 'bg-card' : 'bg-muted/30 text-muted-foreground',
              )}
            >
              <span className="text-xs font-medium tabular-nums">
                {formatAgendaDate(date, { day: 'numeric' })}
              </span>
              <div className="mt-2 flex flex-col gap-1">
                {(sessionsByDate.get(date) ?? []).map((session) => (
                  // The chip is a LINK, to the same route the List and Conflicts tabs send a
                  // title to. It was an inert `Badge`: the month grid could show a session
                  // and offered no way to open it.
                  //
                  // Safe here and deliberately NOT done on the Day, Week and Rooms
                  // timelines. Those cards are `useDraggable` with the pointer listeners
                  // spread across the whole card, and an anchor is natively draggable, so a
                  // link inside one fights the drag: a few pixels of movement would navigate
                  // instead of moving the session. A month chip is not draggable.
                  <Badge
                    key={session.id}
                    variant="secondary"
                    className="h-auto w-full justify-start gap-1 overflow-hidden py-1"
                    render={<Link href={`/admin/${data.event.id}/abstracts/${session.id}`} />}
                  >
                    <span className="min-w-0 flex-1 truncate">{session.title}</span>
                    <ConflictBadge count={report.bySession.get(session.id)?.length ?? 0} compact />
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function monthAnchor(data: AgendaData): string | undefined {
  if (data.event.startsAt !== undefined) {
    return dateKeyAt(data.event.startsAt, data.event.timezone)
  }
  const firstScheduled = data.sessions.find((session) => session.startsAt !== undefined)
  return firstScheduled?.startsAt === undefined
    ? undefined
    : dateKeyAt(firstScheduled.startsAt, data.event.timezone)
}

function groupSessions(data: AgendaData, dates: readonly string[]) {
  const grouped = new Map(dates.map((date) => [date, [] as AgendaData['sessions'][number][]]))
  for (const session of data.sessions) {
    if (session.startsAt === undefined || session.scheduleStatus === 'unscheduled') continue
    const date = dateKeyAt(session.startsAt, data.event.timezone)
    const rows = date === undefined ? undefined : grouped.get(date)
    rows?.push(session)
  }
  return grouped
}
