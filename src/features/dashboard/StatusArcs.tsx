'use client'

// The recharts arcs of ref 36's SUBMISSION STATUS donut. One of the two modules in the
// dashboard that imports recharts, and the `next/dynamic` target of StatusDonut.tsx.
//
// Draws only. The counts, the percentages and the centre number were computed on the server
// by `status-mix.ts`, which is also where the abstract/session split is decided from
// `reviewRequired` (BUILD_SPEC 5.1b).

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

export type DonutSlice = { id: string; label: string; count: number; fill: string }

export function StatusArcs({ slices }: { slices: readonly DonutSlice[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Tooltip
          contentStyle={{
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--popover-foreground)',
            // A slice count, redrawn as the pointer moves between arcs.
            fontVariantNumeric: 'tabular-nums',
          }}
        />
        <Pie
          data={[...slices]}
          dataKey="count"
          nameKey="label"
          innerRadius="62%"
          outerRadius="92%"
          // The ring is the shape; the numbers are in the legend and the centre, so labels on
          // the arcs would be a third copy of the same figures.
          isAnimationActive={false}
          stroke="var(--background)"
          strokeWidth={2}
        >
          {slices.map((slice) => (
            <Cell key={slice.id} fill={slice.fill} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  )
}
