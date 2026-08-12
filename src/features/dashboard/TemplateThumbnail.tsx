// The preview thumbnail on a gallery card, ref 40.
//
// Ref 40's thumbnails are miniatures of the dashboard the card creates: `Event Overview` shows
// four stat tiles over a bar chart and a donut, `Speaker Tracking` shows two stats, a donut and
// six horizontal bars, and `Schedule Health` shows two stats and two bar groups. So this draws
// the same thing from the template's own widget list rather than shipping six pictures: one
// block per widget, in the shape that widget takes. A template whose widget set changes cannot
// then advertise a preview of something else.
//
// Pure CSS and no data. The numbers in ref 40's thumbnails are mock values (`SUBMISSIONS 248`,
// `SPEAKERS 86`) on an event whose real dashboard reads 4 and 2, so they are decoration in the
// reference too, and drawing bars with no numbers at all is the version that cannot be mistaken
// for this event's figures.

import { widgetSpec } from '@/features/dashboard/widget-catalog'
import type { WidgetMetric, WidgetType } from '@/services/airtable/mapping-dashboards'

/** Deterministic widths, so a thumbnail does not reshuffle between renders. */
const BAR_WIDTHS = ['100%', '78%', '62%', '48%', '34%', '22%']

export function TemplateThumbnail({ metrics }: { metrics: readonly WidgetMetric[] }) {
  const shapes = metrics.map((metric) => widgetSpec(metric).widgetType)

  return (
    <div className="flex h-24 flex-wrap content-start gap-1.5 overflow-hidden rounded-lg border border-border bg-muted/50 p-2">
      {shapes.length === 0 ? <Shape type="stat" /> : null}
      {shapes.map((type, index) => (
        <Shape key={`${type}-${index}`} type={type} />
      ))}
    </div>
  )
}

function Shape({ type }: { type: WidgetType }) {
  if (type === 'stat') {
    return (
      <div className="flex h-8 min-w-14 flex-1 flex-col justify-center gap-1 rounded-md bg-background px-1.5">
        <span className="h-1 w-6 rounded-full bg-muted-foreground/40" />
        <span className="h-2 w-4 rounded-sm bg-foreground/70" />
      </div>
    )
  }

  if (type === 'donut') {
    return (
      <div className="flex h-14 flex-1 items-center justify-center rounded-md bg-background">
        <span className="size-8 rounded-full border-4 border-foreground/25 border-t-foreground/70" />
      </div>
    )
  }

  if (type === 'bar') {
    return (
      <div className="flex h-14 flex-1 items-end gap-1 rounded-md bg-background p-1.5">
        <span className="h-full w-2 rounded-t-sm bg-foreground/60" />
        <span className="h-2/3 w-2 rounded-t-sm bg-foreground/45" />
        <span className="h-1/2 w-2 rounded-t-sm bg-foreground/30" />
        <span className="h-1/3 w-2 rounded-t-sm bg-foreground/20" />
      </div>
    )
  }

  return (
    <div className="flex h-14 flex-1 flex-col justify-center gap-1 rounded-md bg-background p-1.5">
      {BAR_WIDTHS.slice(0, 4).map((width) => (
        <span key={width} className="h-1.5 rounded-full bg-foreground/40" style={{ width }} />
      ))}
    </div>
  )
}
