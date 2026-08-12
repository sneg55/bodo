'use client'

// The pacing chart's controls, and the `next/dynamic` boundary that keeps recharts out of
// the event home's first paint.
//
// This component is client because ref 34's axis toggle is client state, and it is
// deliberately the SMALL half: it holds the legend, the two toggle buttons and a skeleton,
// while `PacingLines` holds the library. `ssr: false` because a chart measures its container
// before it can lay out, so server-rendering it produces markup that is replaced on hydrate
// anyway. Same shape as `AgendaSurface` -> `timeline/AgendaTimeline` for @dnd-kit and
// `RichTextEditor` -> `RichTextEditorBody` for TipTap.

import dynamic from 'next/dynamic'
import { useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { PacingPoint, PacingTick } from '@/features/dashboard/pacing'

import type { PacingAxis } from './PacingLines'

const PacingLines = dynamic(() => import('./PacingLines').then((module) => module.PacingLines), {
  ssr: false,
  loading: () => <Skeleton className="h-60 w-full rounded-lg" />,
})

/** Ref 34's toggle, verbatim. */
const AXIS_LABELS: readonly { value: PacingAxis; label: string }[] = [
  { value: 'days', label: 'Days before event' },
  { value: 'calendar', label: 'Calendar date' },
]

export function PacingChart({
  points,
  ticks,
  /**
   * False when the event has no start date. There is no T-minus to count from, so the axis
   * shows calendar dates and the toggle is not offered rather than offering a choice that
   * would read "T-NaNd".
   */
  anchored,
}: {
  points: readonly PacingPoint[]
  ticks: readonly PacingTick[]
  anchored: boolean
}) {
  const [axis, setAxis] = useState<PacingAxis>(anchored ? 'days' : 'calendar')

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span aria-hidden className="inline-block h-0.5 w-4 rounded-full bg-chart-1" />
          This event
        </span>

        {anchored ? (
          <ToggleGroup
            value={[axis]}
            onValueChange={(next: string[]) => {
              const chosen = next[0]
              if (chosen === 'days' || chosen === 'calendar') setAxis(chosen)
            }}
            variant="outline"
            size="sm"
          >
            {AXIS_LABELS.map((entry) => (
              // `size="sm"` is 28px tall and both labels are a sentence wide, so the height
              // is the only thing short. `hit-area-y` keeps the width the item already has,
              // which is what stops the two of them meeting across the group's 8px gap.
              <ToggleGroupItem key={entry.value} value={entry.value} className="hit-area-y">
                {entry.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
      </div>

      <PacingLines points={points} ticks={ticks} axis={axis} />
    </div>
  )
}
