// The Agenda sub-tab: where the accepted programme stands on getting onto the schedule.
//
// **This panel was never captured**, and the parity doc lists its contents under Ambiguities.
// It used to say one sentence and link out, which made it the only one of Today's four tabs
// that answered no question: an organizer clicked a peer of three data panels and got a
// signpost. The two honest options were to stop presenting it as a peer or to give it
// something real, and it stays a tab because ref 34's strip is four tabs and dropping one is a
// different strip. So it is the second option, under the same SPEC.md line 55 exception the
// `AI prompt` pane was built under: the tab's EXISTENCE is captured and only its interior is
// invented, and what is invented here is counts rather than a widget set nobody has seen.
//
// Nothing about the reference's own Agenda panel is claimed. These are four counts over the
// submission list this page already holds, two of them the advisory strip's own predicates, so
// the panel costs no read and can state nothing the strip contradicts (agenda-readiness.ts).

import { ChevronRightIcon } from 'lucide-react'
import Link from 'next/link'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { agendaReadiness } from '@/features/dashboard/agenda-readiness'
import type { SubmissionWithParticipants } from '@/types/domain'

export function PanelAgenda({
  submissions,
  agendaHref,
}: {
  submissions: readonly SubmissionWithParticipants[]
  agendaHref: string
}) {
  const view = agendaReadiness(submissions)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Agenda</CardTitle>
          <Link
            href={agendaHref}
            className="inline-flex items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Open agenda
            <ChevronRightIcon className="size-3.5" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {view.accepted === 0 ? (
          // Zero accepted sessions is not an empty panel, it is the state before scheduling
          // can start, and four zeroes would read as a failed load rather than as that.
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-pretty text-muted-foreground">
            Sessions reach the agenda once they are accepted. None have been yet.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <AgendaStat label="Accepted sessions" value={view.accepted} />
            <AgendaStat label="Scheduled" value={view.slotted} />
            <AgendaStat label="Awaiting a time slot" value={view.awaitingSlot} />
            <AgendaStat label="Awaiting publication" value={view.awaitingPublication} />
          </div>
        )}
        <p className="text-xs text-pretty text-muted-foreground">
          Scheduling lives on the Agenda builder, with the day, week, room and conflict views.
        </p>
      </CardContent>
    </Card>
  )
}

/** The same box the Review progress tiles use, so the two sub-tabs read as one dashboard. */
function AgendaStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-heading text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}
