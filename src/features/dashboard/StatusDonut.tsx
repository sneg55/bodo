'use client'

// The `next/dynamic` boundary for the SUBMISSION STATUS donut, and the centre label that
// sits inside the ring.
//
// Client, and small on purpose: recharts arrives only when this component mounts, and never
// in the initial bundle of any admin route (see PacingChart.tsx for the same shape and the
// reason). `ssr: false` because an arc chart measures its container before it can lay out.
//
// The zero case does not load recharts at all: a ring with nothing in it is a bordered
// circle, and a library that draws nothing is a library nobody needed.

import dynamic from 'next/dynamic'

import { Skeleton } from '@/components/ui/skeleton'

import type { DonutSlice } from './StatusArcs'

const StatusArcs = dynamic(() => import('./StatusArcs').then((module) => module.StatusArcs), {
  ssr: false,
  loading: () => <Skeleton className="h-50 w-full rounded-lg" />,
})

export function StatusDonut({
  slices,
  centreValue,
  centreCaption,
}: {
  slices: readonly DonutSlice[]
  centreValue: number
  /** Ref 36: "awaiting decision", under the count. */
  centreCaption: string
}) {
  const empty = slices.every((slice) => slice.count === 0)

  return (
    <div className="relative">
      {empty ? (
        <div className="flex h-50 items-center justify-center">
          <div className="size-32 rounded-full border-[1.25rem] border-muted" />
        </div>
      ) : (
        <StatusArcs slices={slices} />
      )}

      {/* Centred over the ring rather than inside the SVG: it is text, and text in an SVG
          does not inherit the type scale or wrap. `pointer-events-none` keeps the arcs
          hoverable underneath it. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span className="font-heading text-3xl font-semibold tabular-nums">{centreValue}</span>
        <span className="text-xs text-muted-foreground">{centreCaption}</span>
      </div>
    </div>
  )
}
