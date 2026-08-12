// One rendered widget: the visitor's controls, the chosen layout, and the state that joins them.
//
// A SERVER component wrapping a client provider, which is the arrangement that keeps all five
// layouts off the browser: `EmbedViewStateProvider` receives this tree as `children`, so only
// the two bars and a two-line island per row are client code (see EmbedViewState.tsx).
//
// It exists because there are now two callers and they must not drift. `/embed/<publicId>` is
// the iframe an organizer pastes into their own website; `/agenda/<slug>` and its four sibling
// surfaces are the same widgets served as the event's own public pages. Before that second
// caller existed the public agenda was a static stack of sections with no search box, no
// filters, no day navigation and no clickable session, while the embed built on the identical
// rows had all four. Two implementations of one thing is exactly how that gap opened.
//
// The chrome around this differs per caller and is deliberately NOT here: the embed wraps it in
// `EmbedFrame` (a coloured band sized by somebody else's page), the public site wraps it in its
// own header and surface nav.

import { browsableSessions } from '@/features/cms/browsable'
import {
  EmbedBrowseBar,
  type EmbedBrowseDay,
  EmbedResultCount,
} from '@/features/cms/EmbedBrowseBar'
import { EmbedEmptyState } from '@/features/cms/EmbedFrame'
import { EmbedScheduleBar } from '@/features/cms/EmbedScheduleBar'
import { EmbedViewStateProvider } from '@/features/cms/EmbedViewState'
import { EmbedViewBody } from '@/features/cms/EmbedViews'
import type { EmbedProjection } from '@/features/cms/projection'

export function EmbedSurface({
  projection,
  stateKey,
  personal = false,
}: {
  projection: EmbedProjection
  /**
   * What the visitor's starred sessions are stored under. The embed's opaque `publicId`, so two
   * widgets on one host page keep separate selections; the public site passes its own key, so a
   * visitor's picks survive moving between its surfaces.
   */
  stateKey: string
  /**
   * Is this surface the visitor's OWN schedule rather than the programme?
   *
   * It starts the star filter on, so a nav item reading `My schedule` lands on the visitor's picks
   * instead of on the full agenda with the picks behind a toggle they have to find. That was the
   * defect: two eval agents followed that nav item and got the entire programme.
   *
   * NOT YET WIRED, AND THERE IS EXACTLY ONE CALL SITE FOR IT. It belongs to the public site's
   * `schedule` surface and to nothing else, because a pasted widget set to the Schedule Itinerary
   * view is an organizer putting the whole programme on their own website. Two lines land it:
   *
   *   - `src/features/cms/public-site.ts`: give `PublicSiteSurface` an optional `personal?: true`
   *     and set it on the `{ segment: 'schedule', label: 'My schedule' }` entry, so the surface
   *     table stays the one place that says what each page IS.
   *   - `src/features/cms/PublicSitePage.tsx`: `<EmbedSurface ... personal={surface.personal ===
   *     true} />` in `PublicSiteBody`.
   *
   * `false` until then, so every current caller is unchanged. `EmbedViewState.tsx` carries the
   * rest of the reasoning, including why the pre-hydration render of a personal surface is a
   * skeleton rather than the whole programme collapsing to two rows a moment later.
   */
  personal?: boolean
}) {
  if (projection.empty) return <EmbedEmptyState view={projection.view} />

  return (
    <EmbedViewStateProvider
      embedId={stateKey}
      sessions={browsableSessions(projection.body)}
      personal={personal}
    >
      <EmbedBrowseBar days={daysOf(projection)} />
      <EmbedScheduleBar eventName={projection.eventName} />
      {/* Between the controls and the list, so "3 of 13 sessions" is in the same glance as the
          search box that produced it and the rows it counts. */}
      <EmbedResultCount />
      {/* `fields` is the Field Options selection for the card this view draws, resolved in the
          projection with the required tier unioned back in. Passed here rather than read inside
          the views so one place decides which card a view belongs to. */}
      <EmbedViewBody body={projection.body} fields={projection.fields} />
    </EmbedViewStateProvider>
  )
}

/**
 * The days the visitor can jump between.
 *
 * Only the two day-GROUPED views have any. The flat session list carries its own date on every
 * row and has no headings to navigate to, so it offers none and the tabs do not render: a day
 * control over an ungrouped list would scroll to nothing.
 */
function daysOf(projection: EmbedProjection): readonly EmbedBrowseDay[] {
  switch (projection.body.view) {
    case 'agenda':
    case 'schedule_itinerary':
      return projection.body.days.map((day) => ({ key: day.key, label: day.label }))
    case 'session_list':
    case 'speaker_list':
    case 'speaker_gallery':
      return []
  }
}
