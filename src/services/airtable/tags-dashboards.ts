// Cache tags for Dashboards and DashboardWidgets. Same shape and same contract as tags.ts.
//
// Two tags, both scoped to the EVENT, and the widgets one is deliberately not per dashboard.
// That is a fact about how Next caches, not a preference: the fetch cache key is
// `JSON.stringify([prefix, keyPrefix, url, method, bodyType, headers, mode, ...])` in
// node_modules/next/dist/server/lib/incremental-cache/index.js and `tags` is NOT in it. Both
// reads list a whole table and filter in code (an Airtable formula cannot see a link as a
// record id, see reads.ts), so every dashboard on the base shares ONE request URL and
// therefore one cache entry. Tagging that entry `dashboard:{id}:widgets` would attach
// whichever dashboard happened to populate it first and leave every other dashboard's tag
// expiring nothing at all.
//
// So the widgets tag is one per event, which is still fine-grained where it matters: adding a
// widget expires `event:{id}:dashboard-widgets` and nothing else, so the agenda, the
// submissions list and the review graph all keep their cache entries.
//
// Its own file rather than two more exports on tags.ts because tags.ts is being edited
// concurrently for other surfaces, the same reason tags-cms.ts gives.

import type { RecordId } from '@/types/domain'

/** Every custom dashboard on one event: the tab strip and the New Dashboard modal. */
export const eventDashboardsTag = (eventId: RecordId): string => `event:${eventId}:dashboards`

/**
 * Every widget on every dashboard of one event.
 *
 * One tag for all of them, see the header. A dashboard page reads this once and filters to
 * its own widgets, so the page costs one Airtable round trip per invalidation rather than one
 * per dashboard in the strip.
 */
export const eventDashboardWidgetsTag = (eventId: RecordId): string =>
  `event:${eventId}:dashboard-widgets`
