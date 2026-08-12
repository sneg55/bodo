// Ref 36's SUBMISSION STATUS section inside Program snapshot: the description, the donut with
// its centre count, and a legend row per segment with count, percent and drill-down chevron.
//
// Server component. The donut's arcs are the only client part (StatusDonut.tsx dynamically
// imports recharts), and the legend is rendered here so it comes back in the first paint and
// reads the same numbers the arcs do.

import { ChevronRightIcon } from 'lucide-react'
import Link from 'next/link'
import {
  STATUS_MIX_DESCRIPTION,
  type StatusMixSegmentId,
  type StatusMixView,
} from '@/features/dashboard/status-mix'
import { cn } from '@/utils/cn'

import { StatusDonut } from './StatusDonut'

/**
 * One token per segment, in ref 36's legend order. A list of pairs rather than a keyed record
 * so the arcs, the dots and the order all come from one place.
 */
const SEGMENT_STYLES: readonly {
  id: StatusMixSegmentId
  /** For the legend dot. */
  className: string
  /** For the arc, which is an SVG fill and cannot take a Tailwind class. */
  fill: string
}[] = [
  { id: 'accepted_abstracts', className: 'bg-chart-1', fill: 'var(--chart-1)' },
  { id: 'accepted_sessions', className: 'bg-chart-2', fill: 'var(--chart-2)' },
  { id: 'pending_abstracts', className: 'bg-chart-3', fill: 'var(--chart-3)' },
  { id: 'pending_sessions', className: 'bg-chart-4', fill: 'var(--chart-4)' },
]

export function StatusMix({
  view,
  segmentHref,
}: {
  view: StatusMixView
  /** Ref 36's chevrons imply a filtered list; the caller decides which one. */
  segmentHref: (id: StatusMixSegmentId) => string
}) {
  const styleOf = (id: StatusMixSegmentId) => SEGMENT_STYLES.find((style) => style.id === id)

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground">SUBMISSION STATUS</h3>
      <p className="text-sm text-pretty text-muted-foreground">{STATUS_MIX_DESCRIPTION}</p>

      <StatusDonut
        centreValue={view.awaiting}
        centreCaption="awaiting decision"
        slices={view.segments.map((segment) => ({
          id: segment.id,
          label: segment.label,
          count: segment.count,
          fill: styleOf(segment.id)?.fill ?? 'var(--chart-1)',
        }))}
      />

      <ul className="flex flex-col">
        {view.segments.map((segment) => (
          <li key={segment.id}>
            <Link
              href={segmentHref(segment.id)}
              className="flex items-center gap-2 rounded-md px-1 py-2 text-sm hover:bg-muted"
            >
              <span
                aria-hidden
                className={cn(
                  'size-2.5 shrink-0 rounded-full',
                  styleOf(segment.id)?.className ?? 'bg-chart-1',
                )}
              />
              <span className="truncate">{segment.label}</span>
              <span className="ml-auto tabular-nums">{segment.count}</span>
              <span className="w-10 text-right text-muted-foreground tabular-nums">
                {`${segment.percent}%`}
              </span>
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
