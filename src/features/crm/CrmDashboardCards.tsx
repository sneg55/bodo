// The CRM dashboard's widgets. Server components: every number was computed by
// `dashboard.ts`, so nothing here can render a different total than the page did.
//
// NO CHARTING LIBRARY, for the reason `WidgetCard` records about the event dashboard: bars
// are widths, which CSS does natively, so they cost zero client JavaScript, cannot disagree
// with the numbers printed beside them, and appear in the first paint rather than after a
// hydrate. The deployed Worker has little gzip headroom and a chart dependency in an admin
// route's initial bundle is how a deploy last failed validation.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { CrmPendingLink } from '@/features/crm/CrmPendingLink'
import type { CrmMetricRow, CrmMonthPoint, CrmTopSpeaker } from '@/features/crm/dashboard'
import { monthBarPercent } from '@/features/crm/dashboard-bars'

/** What a widget shows instead of an empty frame. Ref 38's per-widget empty state, verbatim. */
const NO_DATA = 'No data'

export function StatTile({
  label,
  value,
  caption,
  href,
}: {
  label: string
  value: number
  caption?: string
  href?: string
}) {
  const body = (
    <CardContent className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-heading text-2xl font-semibold tabular-nums">{value}</span>
      {caption === undefined ? null : (
        <span className="text-xs text-muted-foreground">{caption}</span>
      )}
    </CardContent>
  )
  if (href === undefined) return <Card>{body}</Card>
  // A tile that leads somewhere is a link, not a card with a link in it: the whole tile is
  // the target, which is what a number an organizer wants to act on should be.
  //
  // `CrmPendingLink` for the same reason the rows below use it: both destinations are dynamic
  // routes that read Airtable, and a tile that looks identical for the seconds after it is
  // clicked is one an organizer clicks again.
  return (
    <Card className="transition-colors hover:border-primary">
      <CrmPendingLink
        href={href}
        className="relative block"
        spinnerClassName="absolute top-3 right-3 text-muted-foreground"
      >
        {body}
      </CrmPendingLink>
    </Card>
  )
}

/**
 * A labelled bar list: the shape every breakdown on this page uses.
 *
 * `Progress` rather than a hand-rolled div, per .claude/rules/ui-shadcn.md, and it carries
 * the accessible value with it so the bar is not decoration a screen reader has to skip.
 */
export function BarListCard({
  title,
  rows,
  emptyMessage = NO_DATA,
}: {
  title: string
  rows: readonly CrmMetricRow[]
  emptyMessage?: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-1.5">
                <span className="flex items-baseline gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  <span className="tabular-nums">{row.count}</span>
                  <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                    {`${row.percent}%`}
                  </span>
                </span>
                <Progress value={row.percent} className="h-1.5" />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The invitation series, as columns.
 *
 * Heights are a percentage of the busiest month rather than of a fixed ceiling, because the
 * question this answers is about SHAPE - when did we do the sending - and an absolute scale
 * flattens twelve months of a small conference into twelve invisible stubs. The counts are
 * printed above the bars, so the scale being relative cannot mislead anyone about the values.
 *
 * EACH BAR SITS IN A TRACK OF ITS OWN, and the track is where the height comes from. The bars
 * were previously percentage-height children of the `<li>`, which is a flex item with no
 * height of its own, so every percentage resolved against `auto` and every bar computed to
 * `height: 0` - measured on the running server, `ol.h-40 > li > span` had height 0 while its
 * `<li>` was 38.28px of text. A percentage only means anything against a DEFINITE height, so
 * the track carries one (`h-24`) and the bar is a percentage of that.
 */
export function MonthBarsCard({
  title,
  points,
}: {
  title: string
  points: readonly CrmMonthPoint[]
}) {
  const peak = Math.max(0, ...points.map((point) => point.count))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <p className="text-sm text-muted-foreground">No portal invitations have been sent yet.</p>
        ) : (
          <ol className="flex h-40 items-end gap-1">
            {points.map((point) => (
              <li key={point.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <span className="text-xs tabular-nums">{point.count}</span>
                {/* The track: a definite 6rem, which is what the bar's percentage resolves
                    against. `items-end` so the bar grows up from the axis. */}
                <span className="flex h-24 w-full items-end">
                  <span
                    aria-hidden
                    className="w-full rounded-t-sm bg-chart-1"
                    style={{ height: `${String(monthBarPercent(point.count, peak))}%` }}
                  />
                </span>
                <span className="w-full truncate text-center text-[10px] text-muted-foreground">
                  {point.label}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

/** The people carrying the programme, each linking into their own CRM profile. */
export function TopSpeakersCard({ speakers }: { speakers: readonly CrmTopSpeaker[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Most sessions
        </CardTitle>
      </CardHeader>
      <CardContent>
        {speakers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody in your events is cast on a session yet.
          </p>
        ) : (
          <ul className="flex flex-col">
            {speakers.map((speaker) => (
              <li key={speaker.id}>
                {/* The profile behind this row is a dynamic route with no `loading.tsx` of its
                    own, so the click is followed by seconds of an unchanged page unless the
                    row says otherwise. See `CrmPendingLink`. */}
                <CrmPendingLink
                  href={`/admin/crm/${speaker.id}`}
                  className="flex items-center gap-2 rounded-md px-1 py-2 text-sm hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate">{speaker.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {`${speaker.eventCount} events`}
                  </span>
                  <span className="w-10 text-right tabular-nums">{speaker.sessionCount}</span>
                </CrmPendingLink>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
