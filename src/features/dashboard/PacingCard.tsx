// The Submission Pacing card, refs 34 and 35.
//
// A server component around a small client one: the four mini stats, the copy and the
// prior-edition caption are static, so only the axis toggle and the chart itself cross into
// the client bundle (PacingChart.tsx, which is where recharts is dynamically imported).
//
// Every string here is transcribed. The card title, the subtitle, the four mini-stat labels,
// the caption under the chart and the two dashes in the "vs prior" tile are all off refs 34
// and 35; the tile ORDER is the captured one too.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { type PacingView, signedCount } from '@/features/dashboard/pacing'

import { PacingChart } from './PacingChart'

/** Ref 34's subtitle. */
const SUBTITLE = 'Cumulative submissions in the run-up to event start.'

/**
 * Ref 35's caption under the chart.
 *
 * Shipped as the caption it is, with no picker behind it. Choosing a prior event needs a
 * read across events the organizer belongs to plus that event's whole submission list, which
 * is a fan-out this page has no cached read for; `submissionPacing` already takes a prior
 * series and is tested against one, so the arithmetic is there when the read is. Until then
 * the "vs prior" tile shows the empty state ref 34 shows, which is what an event with no
 * prior edition looks like anyway.
 */
const PRIOR_CAPTION = 'Pick a prior event to compare submission pacing edition-over-edition.'

/**
 * The placeholder for a figure that does not exist. Ref 34's "vs prior (T-65d)" tile shows TWO
 * of them when there is no prior edition, which is why the tile below takes both a value and a
 * detail; "Days to event" shows one when the event has no start date.
 */
const DASH = '-'

export function PacingCard({ view }: { view: PacingView }) {
  const { stats } = view

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Submission Pacing</CardTitle>
        <p className="text-sm text-pretty text-muted-foreground">{SUBTITLE}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MiniStat label="Submissions" value={String(stats.submissions)} />
          <MiniStat
            label={stats.vsPriorLabel}
            value={stats.vsPrior === undefined ? DASH : signedCount(stats.vsPrior)}
            // The second dash of the pair. Ref 34 shows the tile with two of them, which is
            // the honest rendering of "there is no prior edition to subtract".
            detail={stats.vsPrior === undefined ? DASH : undefined}
          />
          <MiniStat
            label="Days to event"
            value={stats.daysToEvent === undefined ? DASH : String(stats.daysToEvent)}
          />
          <MiniStat label="This week vs prior" value={signedCount(stats.thisWeekVsPrior)} />
        </div>

        <PacingChart points={view.points} ticks={view.ticks} anchored={view.anchor === 'event'} />

        <p className="text-xs text-pretty text-muted-foreground">{PRIOR_CAPTION}</p>
      </CardContent>
    </Card>
  )
}

function MiniStat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      {/* The label carries a figure too: `vs prior (T-65d)` counts down a day at a time, so
          it needs the same tabular figures as the value under it. */}
      <p className="text-xs text-muted-foreground tabular-nums">{label}</p>
      <p className="font-heading text-2xl font-semibold tabular-nums">{value}</p>
      {detail === undefined ? null : (
        <p className="text-xs text-muted-foreground tabular-nums">{detail}</p>
      )}
    </div>
  )
}
