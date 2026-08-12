// A custom dashboard, refs 38 and 39: the header the two captured dashboards share, then the
// widget grid.
//
// The shell is transcribed: the `CUSTOM DASHBOARD` label prefixed by the dashboard's own
// coloured dot, the description line under it, and `+ Add Widget` and `Settings` right-aligned.
// The tab strip above it is the same component the Today dashboard renders, so a tab cannot be
// active in one place and missing in the other.
//
// Server component. Every widget's numbers were computed by `widget-views.ts` before this
// rendered; the two buttons are the only client code on the screen.

import { AddWidgetButton } from '@/features/dashboard/AddWidgetButton'
import { DashboardDot } from '@/features/dashboard/DashboardDot'
import { DashboardSettingsButton } from '@/features/dashboard/DashboardSettingsButton'
import { DashboardTabs } from '@/features/dashboard/DashboardTabs'
import type { CustomDashboardView } from '@/features/dashboard/dashboard-reads'
import { HomeHeader } from '@/features/dashboard/HomeHeader'
import { WidgetCard } from '@/features/dashboard/WidgetCard'
import { cn } from '@/utils/cn'

/** Refs 38 and 39's label over the description line. */
const CUSTOM_DASHBOARD_LABEL = 'CUSTOM DASHBOARD'

/**
 * How a widget arrives on the grid: a short rise and fade, not a single container animating
 * as one block.
 *
 * `fill-mode-backwards` is not optional next to a delay. Without it a delayed card paints at
 * full opacity first and only then snaps back to the animation's first frame, which is a
 * flash rather than a stagger. `backwards` rather than `both`, for the reason
 * `PALETTE_GROUP_ENTER` gives: only the delay window needs covering.
 */
const WIDGET_ENTER =
  'animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-backwards duration-300 ease-[cubic-bezier(0.2,0,0,1)]'

/**
 * The step between one widget's entrance and the next, CAPPED at two steps.
 *
 * The cap is the point, and it is the same rule `groupEnterDelay` follows in GlobalSearch. A
 * dashboard can hold eight widgets; an eighth card 800ms behind the first is not a stagger,
 * it is a queue, and the grid is two columns wide so a strict per-index delay would also make
 * the second column trail the first by a visibly different amount on every row.
 *
 * A ternary rather than an indexed table, because a computed index into an array is what
 * `security/detect-object-injection` fails the build over.
 */
function widgetEnterDelay(index: number): string {
  if (index === 0) return ''
  return index === 1 ? 'delay-100' : 'delay-200'
}

export function CustomDashboard({ eventId, view }: { eventId: string; view: CustomDashboardView }) {
  const { dashboard, cells } = view

  return (
    <div className="flex flex-col gap-6">
      {/* The same kicker and greeting the Today tab has: refs 38 and 39 keep the page header
          above the tab strip, so it is chrome for every dashboard and not part of Today. */}
      <HomeHeader event={view.event} eventId={eventId} now={new Date()} />

      <DashboardTabs eventId={eventId} tabs={view.tabs} active={dashboard.id} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground">
            <DashboardDot color={dashboard.color} />
            {CUSTOM_DASHBOARD_LABEL}
          </span>
          {dashboard.description === undefined ? null : (
            <p className="text-sm text-muted-foreground">{dashboard.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <AddWidgetButton
            eventId={eventId}
            dashboardId={dashboard.id}
            present={cells.map((cell) => cell.widget.metric)}
          />
          <DashboardSettingsButton eventId={eventId} dashboard={dashboard} />
        </div>
      </div>

      {cells.length === 0 ? (
        // Not captured: every custom dashboard in the reference has widgets. A dashboard can be
        // empty here (a template the closed metric enum cannot fill, or every widget deleted),
        // and the honest thing is to say so and point at the control that fixes it rather than
        // to render an empty grid that looks like a failed load.
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-pretty text-muted-foreground">
          No widgets yet. Add one to start tracking this dashboard.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Each card is told its neighbours rather than its index, because that is what its
              menu posts back: `swapWidgetOrder` has the reason a position computed on the
              server would be over a list this grid is not showing. The ends therefore have no
              neighbour on one side, which is what disables Move up on the first card and Move
              down on the last. */}
          {cells.map((cell, index) => (
            <WidgetCard
              key={cell.widget.id}
              eventId={eventId}
              dashboardId={dashboard.id}
              widgetId={cell.widget.id}
              title={cell.widget.title}
              view={cell.view}
              previousId={cells[index - 1]?.widget.id}
              nextId={cells[index + 1]?.widget.id}
              className={cn(WIDGET_ENTER, widgetEnterDelay(index))}
            />
          ))}
        </div>
      )}
    </div>
  )
}
