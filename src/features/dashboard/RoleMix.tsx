// PARTICIPANTS BY ROLE, ref 36: the description, the deduplicated centre total, the stacked
// bar, and a legend row per role with its count, percent and drill-down chevron.
//
// No charting library, and that is a decision rather than a shortcut. A stacked proportion
// bar is a row of widths that add to 100%, which CSS does natively: rendering it server side
// costs zero client JavaScript, cannot disagree with the legend beside it (both read the same
// percent), and appears in the first paint instead of after a hydrate. recharts earns its
// place on the pacing line and the status donut, which are curves and arcs.
//
// Colours come from the `--chart-*` tokens, so the bar and its legend dots match and dark
// mode is handled by the token layer. Ref 36's bar is green; bodo's palette differs from
// Sessionboard's by design (.claude/rules/ui-shadcn.md).

import { ChevronRightIcon } from 'lucide-react'
import Link from 'next/link'
import type { RoleMixView } from '@/features/dashboard/roles'
import { cn } from '@/utils/cn'

/** Ref 36's description, verbatim, including the sentence about the centre total. */
const DESCRIPTION =
  "Role names (e.g. Speakers, Unconfirmed Speakers) come from this event's participant role settings. Each row is unique people in that role on a submission. The center total deduplicates people in multiple roles."

/** One class per segment, indexed by position, so bar and legend dot always agree. */
const SEGMENT_CLASSES = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5']

export function RoleMix({
  view,
  /**
   * Where a legend chevron goes. Ref 36 implies a list filtered to the role; bodo has no
   * participants list (the parity report waives one), so the caller points every row at the
   * one surface that lists PEOPLE, which is the same call "View participants" already makes.
   */
  roleHref,
}: {
  view: RoleMixView
  roleHref: (role: string) => string
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground">
        PARTICIPANTS BY ROLE
      </h3>
      <p className="text-sm text-pretty text-muted-foreground">{DESCRIPTION}</p>

      <div className="flex flex-col items-center gap-1">
        <p className="font-heading text-3xl font-semibold tabular-nums">{view.uniquePeople}</p>
        <p className="text-xs text-muted-foreground">unique participants</p>
      </div>

      {view.total === 0 ? (
        // Ref 38's per-widget empty state copy, which is the only one the reference gives for
        // a chart with nothing in it.
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No data
        </p>
      ) : (
        <>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
            {view.rows.map((row, index) => (
              <span
                key={row.role}
                className={cn('h-full', segmentClass(index))}
                style={{ width: `${row.percent}%` }}
              />
            ))}
          </div>

          <ul className="flex flex-col">
            {view.rows.map((row, index) => (
              <li key={row.role}>
                <Link
                  href={roleHref(row.role)}
                  className="flex items-center gap-2 rounded-md px-1 py-2 text-sm hover:bg-muted"
                >
                  <span
                    aria-hidden
                    className={cn('size-2.5 shrink-0 rounded-full', segmentClass(index))}
                  />
                  <span className="truncate">{row.label}</span>
                  <span className="ml-auto tabular-nums">{row.count}</span>
                  <span className="w-10 text-right text-muted-foreground tabular-nums">
                    {`${row.percent}%`}
                  </span>
                  <ChevronRightIcon className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function segmentClass(index: number): string {
  return SEGMENT_CLASSES.at(index % SEGMENT_CLASSES.length) ?? 'bg-chart-1'
}
