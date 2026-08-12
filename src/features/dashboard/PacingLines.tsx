'use client'

// The recharts half of the Submission Pacing chart, and the ONLY module in the dashboard
// that imports recharts.
//
// It exists to be the `next/dynamic` target of PacingChart.tsx, exactly as
// `RichTextEditorBody.tsx` is for TipTap and `timeline/AgendaTimeline` is for @dnd-kit:
// recharts is a large dependency, the event home is the first screen anyone opens, and
// speed is judged. Importing it at a layout, or statically anywhere on this page, would put
// the whole library in the initial bundle of every admin route under it.
//
// It computes NOTHING. Every number and every label was produced on the server by
// `pacing.ts`, which reads instants in the event's timezone; arithmetic in here would run on
// the viewer's clock in the viewer's zone and disagree with the tiles above it.

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { PacingPoint, PacingTick } from '@/features/dashboard/pacing'

export type PacingAxis = 'days' | 'calendar'

export function PacingLines({
  points,
  ticks,
  axis,
}: {
  points: readonly PacingPoint[]
  ticks: readonly PacingTick[]
  axis: PacingAxis
}) {
  // Ref 34's toggle changes the LABELS on the same series, so both label sets travel with
  // the tick and nothing is re-bucketed when it is flipped.
  const labels = new Map(
    ticks.map((tick) => [tick.daysBefore, axis === 'days' ? tick.minusLabel : tick.dateLabel]),
  )
  const byDay = new Map(ticks.map((tick) => [tick.daysBefore, tick.dateLabel]))

  return (
    // `tabular-nums` sits on the container rather than on each `tick`: Recharts types the
    // tick object as its own Props, which does not accept fontVariantNumeric, and the
    // property inherits into SVG text anyway. Both axes relabel when the toggle flips, so
    // equal-width figures stop the ticks nudging each other.
    <ResponsiveContainer width="100%" height={240} className="tabular-nums">
      <LineChart data={[...points]} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="daysBefore"
          type="number"
          // T-minus counts DOWN, so the axis is reversed: the run-up reads left to right.
          reversed
          domain={['dataMin', 'dataMax']}
          ticks={ticks.map((tick) => tick.daysBefore)}
          tickFormatter={(value: number) => labels.get(value) ?? ''}
          tick={{
            fontSize: 11,
            fill: 'var(--muted-foreground)',
          }}
          stroke="var(--border)"
        />
        <YAxis
          // Submissions are whole things: "1.5 submitted" is not a state anything can be in.
          allowDecimals={false}
          width={32}
          tick={{
            fontSize: 11,
            fill: 'var(--muted-foreground)',
          }}
          stroke="var(--border)"
        />
        <Tooltip
          contentStyle={{
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--popover-foreground)',
            // The tooltip is two numbers that change as the pointer travels the series.
            fontVariantNumeric: 'tabular-nums',
          }}
          // recharts hands both callbacks loose types (`ValueType`, `ReactNode`), so the
          // narrowing happens here rather than in the signature: a hovered point between two
          // ticks has no precomputed label, and a label that is not a number has no day.
          formatter={(value) => [value as number, 'Cumulative submissions']}
          labelFormatter={(label) => {
            if (typeof label !== 'number') return ''
            return axis === 'days' ? tMinus(label) : (byDay.get(label) ?? tMinus(label))
          }}
        />
        <Line
          type="stepAfter"
          dataKey="cumulative"
          name="This event"
          // The token layer, not a hex: bodo's palette differs from Sessionboard's by design
          // and a hardcoded purple would also break in dark mode.
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Only for a hovered point between ticks, which has no precomputed label. */
function tMinus(daysBefore: number): string {
  return daysBefore < 0 ? `T+${-daysBefore}d` : `T-${daysBefore}d`
}
