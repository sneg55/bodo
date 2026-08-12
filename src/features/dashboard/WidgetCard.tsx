// One widget on a custom dashboard, refs 38 and 39: the four shapes, and the `No data` state
// rendering inside an otherwise normal widget card.
//
// The title renders UPPERCASE, which is how refs 38 and 39 present it (`ACCEPTED SPEAKERS`,
// `SUBMISSIONS BY FORM`), through `uppercase` rather than by uppercasing the stored string:
// the column holds what the catalogue wrote, so a future rename does not have to shout.
//
// **No charting library on this surface.** The bars and the top-N list are widths and heights,
// which CSS does natively: they cost zero client JavaScript, cannot disagree with the numbers
// beside them, and appear in the first paint instead of after a hydrate. The donut reuses
// `StatusDonut`, which is the existing recharts boundary (loaded on mount, never in an admin
// route's initial bundle), so the whole surface adds no dependency and no new chunk. The
// deployed Worker has about 76 KiB of gzip headroom and a new charting dependency is how the
// last deploy failed validation.
//
// Server component throughout, apart from the overflow menu in the header. Every number was
// computed by `widget-views.ts` on the server.

import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { barTicks, type WidgetRow, type WidgetView } from '@/features/dashboard/widget-views'
import { cn } from '@/utils/cn'

import { StatusDonut } from './StatusDonut'
import { WidgetMenu } from './WidgetMenu'

/** Ref 38's per-widget empty state, verbatim. */
const NO_DATA = 'No data'

/** One token per slice, matching StatusMix so a donut looks the same wherever it appears. */
const SLICE_STYLES = [
  { className: 'bg-chart-1', fill: 'var(--chart-1)' },
  { className: 'bg-chart-2', fill: 'var(--chart-2)' },
  { className: 'bg-chart-3', fill: 'var(--chart-3)' },
  { className: 'bg-chart-4', fill: 'var(--chart-4)' },
  { className: 'bg-chart-5', fill: 'var(--chart-5)' },
]

export function WidgetCard({
  eventId,
  dashboardId,
  widgetId,
  title,
  view,
  previousId,
  nextId,
  className,
}: {
  eventId: string
  dashboardId: string
  widgetId: string
  title: string
  view: WidgetView
  /** The widget above this one in the grid, absent on the first. See WidgetMenu. */
  previousId?: string
  /** The widget below this one, absent on the last. */
  nextId?: string
  /**
   * The grid's staggered entrance, passed in rather than set here: the delay depends on the
   * card's position in the grid, which only the grid knows. See CustomDashboard.
   */
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader>
        {/* `text-balance` because `CardTitle` is a div and so misses the h1/h2/h3 rule in
            globals.css. `TOP SPEAKERS BY OUTSTANDING TASKS` is the long one and it wraps to
            two lines in a two-column grid. */}
        <CardTitle className="text-xs font-medium tracking-wide text-balance text-muted-foreground uppercase">
          {title}
        </CardTitle>
        {/* Refs 38 and 39 show no per-card control, and this build had none either, which left
            an added widget with no way off the dashboard short of deleting the dashboard.
            `CardAction` rather than a flex header: the slot is what switches CardHeader to its
            two-column grid, so the title keeps its own column instead of being shortened by a
            button that sits in the same one. */}
        <CardAction>
          <WidgetMenu
            eventId={eventId}
            dashboardId={dashboardId}
            widgetId={widgetId}
            title={title}
            previousId={previousId}
            nextId={nextId}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        <WidgetBody view={view} />
      </CardContent>
    </Card>
  )
}

function WidgetBody({ view }: { view: WidgetView }) {
  if (view.kind === 'empty') {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {NO_DATA}
      </p>
    )
  }

  if (view.kind === 'stat') {
    // Ref 38 shows a big `0` rather than `No data`, so zero is a reading and not an absence.
    return <p className="font-heading text-4xl font-semibold tabular-nums">{view.value}</p>
  }

  if (view.kind === 'donut') {
    return (
      <div className="flex flex-col gap-2">
        <StatusDonut
          centreValue={view.centreValue}
          centreCaption={view.centreCaption}
          slices={view.slices.map((slice, index) => ({
            id: slice.id,
            label: slice.label,
            count: slice.value,
            fill: styleAt(index).fill,
          }))}
        />
        <ul className="flex flex-col">
          {view.slices.map((slice, index) => (
            <li key={slice.id} className="flex items-center gap-2 px-1 py-1.5 text-sm">
              <span
                aria-hidden
                className={cn('size-2.5 shrink-0 rounded-full', styleAt(index).className)}
              />
              <span className="truncate">{slice.label}</span>
              <span className="ml-auto tabular-nums">{slice.value}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (view.kind === 'bar') return <BarChart bars={view.bars} />

  return <TopList rows={view.rows} />
}

/**
 * Ref 39's vertical bar chart: dashed horizontal gridlines, a y axis of five ticks, and one
 * labelled bar per bucket.
 *
 * The ticks come from `barTicks`, which is `max` down to zero in quarters: exactly what ref 39's
 * two charts show, and derived from the data rather than rounded to numbers of its own.
 */
function BarChart({ bars }: { bars: readonly WidgetRow[] }) {
  const max = bars.reduce((highest, bar) => Math.max(highest, bar.value), 0)
  const ticks = barTicks(max)

  return (
    <div className="flex gap-2">
      <div className="flex h-40 flex-col justify-between py-0.5 text-right text-xs text-muted-foreground tabular-nums">
        {ticks.map((tick) => (
          <span key={tick.fraction}>{tick.label}</span>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        <div className="relative h-40">
          {ticks.map((tick) => (
            <span
              key={tick.fraction}
              aria-hidden
              className="absolute inset-x-0 border-t border-dashed border-border"
              style={{ top: `${(1 - tick.fraction) * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-end justify-around gap-2 px-1">
            {bars.map((bar) => (
              <span
                key={bar.id}
                // A bar of height 0 would be invisible, and a bucket only exists here because
                // it has a count, so the floor is a hairline rather than nothing.
                className="min-h-0.5 w-full max-w-12 rounded-t-sm bg-chart-3"
                style={{ height: max === 0 ? '2px' : `${(bar.value / max) * 100}%` }}
              />
            ))}
          </div>
        </div>

        <div className="flex justify-around gap-2 pt-1.5">
          {bars.map((bar) => (
            <span
              key={bar.id}
              className="w-full max-w-16 truncate text-center text-xs text-muted-foreground"
            >
              {bar.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Ref 38's `TOP SPEAKERS BY OUTSTANDING TASKS`: a name, a proportional bar, and the count. */
function TopList({ rows }: { rows: readonly WidgetRow[] }) {
  const max = rows.reduce((highest, row) => Math.max(highest, row.value), 0)

  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-2 text-sm">
          <span className="w-28 shrink-0 truncate">{row.label}</span>
          <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-chart-3"
              style={{ width: max === 0 ? '0%' : `${(row.value / max) * 100}%` }}
            />
          </span>
          <span className="w-6 shrink-0 text-right tabular-nums">{row.value}</span>
        </li>
      ))}
    </ul>
  )
}

function styleAt(index: number) {
  return SLICE_STYLES[index % SLICE_STYLES.length] ?? SLICE_STYLES[0]
}
