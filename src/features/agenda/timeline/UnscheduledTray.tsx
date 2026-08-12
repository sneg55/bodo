'use client'

import { InboxIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'

import type { ConflictReport } from '../conflicts'
import type { AgendaSession } from '../types'
import { AgendaDndCard } from './AgendaDndCard'

export function UnscheduledTray({
  sessions,
  report,
  disabled,
}: {
  sessions: readonly AgendaSession[]
  report: ConflictReport
  disabled: boolean
}) {
  return (
    <Card className="min-h-0 lg:h-[38rem]" size="sm">
      <CardHeader className="border-b">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Unscheduled</CardTitle>
          <Badge variant="secondary" className="tabular-nums">
            {sessions.length}
          </Badge>
        </div>
        <CardDescription>Drag accepted sessions onto a time slot.</CardDescription>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 px-2">
        {sessions.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <InboxIcon className="size-6" />
            <p className="text-sm">All accepted sessions are on the grid.</p>
          </div>
        ) : (
          <ScrollArea className="h-72 lg:h-full">
            <div className="flex flex-col gap-2 p-1">
              {sessions.map((session) => (
                <AgendaDndCard
                  key={session.id}
                  session={session}
                  report={report}
                  disabled={disabled}
                  resize={false}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
