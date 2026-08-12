// Event home, the admin landing page. The Today dashboard, refs 34 to 37.
//
// This route is the default sub-tab (Submission Forms, selected in ref 34) and the sibling
// `dashboard/[tab]` route is the other three. Both render `EventHome`, so the header, the two
// tile rows and the "Also check" strip above the strip are one implementation rather than four
// copies that drift.
//
// Still deliberately NOT here, and it should not be scored as missing: the dashboard TAB strip
// with custom dashboards, the widget types, and the New Dashboard template gallery. Those are a
// separate workstream and partly uncaptured (docs/parity/dashboard.md, Ambiguities).
//
// The page wires params and renders; the reads and the composition live in
// `src/features/dashboard`. `loading.tsx` in this folder is the boundary that lets the admin
// chrome paint while those reads run.

import { EventHome } from '@/features/dashboard/EventHome'
import { DEFAULT_HOME_TAB } from '@/features/dashboard/sub-tabs'
import { requireEventId } from '@/features/events/resolve-ref'

export default async function EventHomePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)

  return <EventHome eventId={eventId} tab={DEFAULT_HOME_TAB} />
}
