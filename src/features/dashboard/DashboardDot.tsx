// The coloured dot a dashboard tab carries, ref 34, and the `CUSTOM DASHBOARD` label's dot,
// refs 38 and 39.
//
// **These four values are DATA, not theme.** `Dashboards.color` is a stored select
// (`DASHBOARD_COLORS`), the organizer picks it, and its whole job is to tell four tabs apart at
// a glance, so it cannot come from the `--chart-*` tokens: those are greyscale in this palette
// (`src/app/globals.css`, chroma 0), and four grey dots distinguish nothing. This is the same
// call the abstracts table already makes for a track or tag chip, which renders its stored
// colour through `style={{ backgroundColor }}`.
//
// The hues are mid-tone on purpose, so a 10px dot stays visible against both the light and the
// dark background without a second value per theme. They are the four names the enum has, which
// is also what ref 34's strip shows (blue, orange, blue, purple); the GIF in
// docs/parity/external-references.md shows a red and a pink dashboard on a different event, and
// those are not in our vocabulary and are not invented here.

import type { DashboardColor } from '@/services/airtable/mapping-dashboards'
import { cn } from '@/utils/cn'

const DOT_VALUES = new Map<DashboardColor, string>([
  ['blue', 'oklch(0.62 0.19 255)'],
  ['orange', 'oklch(0.72 0.17 60)'],
  ['purple', 'oklch(0.6 0.22 300)'],
  ['green', 'oklch(0.65 0.17 150)'],
])

/**
 * The `items` prop Base UI's `Select` needs, or the closed trigger shows the raw stored value.
 *
 * Derived from the map above rather than from `DASHBOARD_COLORS`, because the Settings dialog is
 * a client component and the enum lives in a module that reaches into the Airtable layer: this
 * way the four colours travel to the browser as four strings instead of pulling the schema with
 * them. tests/dashboards-tabs.test.ts pins the two lists together so neither can gain a value
 * the other does not have.
 */
export const DASHBOARD_COLOR_ITEMS: readonly { value: DashboardColor; label: string }[] = [
  ...DOT_VALUES.keys(),
].map((color) => ({ value: color, label: `${color.slice(0, 1).toUpperCase()}${color.slice(1)}` }))

export function dotValue(color: DashboardColor): string {
  // Exhaustive over the union; the fallback is a type requirement, not a reachable branch.
  return DOT_VALUES.get(color) ?? 'oklch(0.62 0.19 255)'
}

export function DashboardDot({ color, className }: { color: DashboardColor; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('size-2.5 shrink-0 rounded-full', className)}
      style={{ backgroundColor: dotValue(color) }}
    />
  )
}
