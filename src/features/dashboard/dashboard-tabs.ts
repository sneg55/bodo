// The dashboard TAB strip, ref 34: `Today` plus one tab per custom dashboard, each with a
// coloured dot, and each a URL.
//
// Pure and tested (tests/dashboards-tabs.test.ts), because everything here is a rule that is
// invisible on screen: the order the tabs come out in, the slug each one answers to, and which
// tab a URL segment selects. A strip that renders correctly while linking to the wrong
// dashboard looks exactly like a strip that works.
//
// **Slugs are derived from the name**, because that is what the reference's own URLs look like
// (ref 37 captures `/event/6703/dashboard/evaluations`, a name and not an id) and a record id
// in the address bar is not a clone of that. Two consequences are accepted rather than hidden:
//
//   - The Today SUB-TAB slugs win. They are a fixed four (`sub-tabs.ts`) and the route resolves
//     them first, so a dashboard called "Participants" cannot take that URL. It gets
//     `participants-2` instead of becoming unreachable.
//   - A slug is a function of the ORDERED list, so two dashboards with the same name get
//     `-2` and `-3` by position. Reordering or renaming therefore changes a URL. A dashboard
//     tab is not a link anybody hands out, and the alternative (a record id, or a stored slug
//     column that can go stale against the name) is worse for both readability and drift.
//
// Nothing here reads Airtable and nothing here renders: `DashboardTabs.tsx` is the strip and
// `dashboard-reads.ts` is the read.

import { HOME_TABS } from '@/features/dashboard/sub-tabs'
import type { Dashboard, DashboardColor } from '@/services/airtable/mapping-dashboards'

/** Ref 34's first tab, which is the built-in one and has no Dashboards row. */
export const TODAY_TAB_ID = 'today'

/** Ref 34's Today dot. */
export const TODAY_TAB_COLOR: DashboardColor = 'blue'

export type DashboardTab = {
  /** `today`, or the dashboard's record id. */
  id: string
  label: string
  /** The URL segment this tab answers to. `today` is not routed: see `href`. */
  slug: string
  href: string
  color: DashboardColor
  /** Absent on `Today`, which is the built-in dashboard. */
  dashboardId?: string
}

type DashboardOf = Pick<Dashboard, 'id' | 'name' | 'color' | 'order'>

/**
 * The strip, `Today` first and then the custom dashboards in `order`.
 *
 * Ties break on name and then on record id, so two dashboards an organizer created without
 * touching `order` (both 0, which is what `mapDashboard` gives a blank cell) come out in the
 * same sequence on every request. Without that the strip would reshuffle between renders and
 * the `-2` suffixes above would move with it.
 */
export function dashboardTabs(
  eventId: string,
  dashboards: readonly DashboardOf[],
): readonly DashboardTab[] {
  const taken = new Set<string>([TODAY_TAB_ID, ...HOME_TABS.map((tab) => tab.id)])

  const custom = [...dashboards].sort(compareDashboards).map((dashboard) => {
    const slug = uniqueSlug(dashboardSlug(dashboard.name), taken)
    taken.add(slug)
    return {
      id: dashboard.id,
      label: dashboard.name,
      slug,
      href: `/admin/${eventId}/dashboard/${slug}`,
      color: dashboard.color,
      dashboardId: dashboard.id,
    }
  })

  return [
    {
      id: TODAY_TAB_ID,
      label: 'Today',
      slug: TODAY_TAB_ID,
      // The bare event home, which is the URL the sidebar's Dashboard item points at and the
      // one `homeTabHref` gives the default sub-tab. `Today` is a dashboard with sub-tabs of
      // its own, so it deliberately does not get a `/dashboard/today` of its own.
      href: `/admin/${eventId}`,
      color: TODAY_TAB_COLOR,
    },
    ...custom,
  ]
}

/** The tab a `/dashboard/{slug}` segment selects, or `undefined` so the route can 404. */
export function dashboardTabBySlug(
  tabs: readonly DashboardTab[],
  slug: string,
): DashboardTab | undefined {
  return tabs.find((tab) => tab.slug === slug)
}

/**
 * A name as a URL segment: lowercase, and anything that is not a letter or a digit becomes a
 * single hyphen.
 *
 * `dashboard` is the fallback for a name made entirely of punctuation, which is a name Airtable
 * accepts and a URL cannot carry. It goes through the same uniquifier as everything else, so
 * two of them are `dashboard` and `dashboard-2` rather than one unreachable tab.
 */
export function dashboardSlug(name: string): string {
  const slug = name
    .toLowerCase()
    // Unicode-aware, so "Führung" keeps its letters instead of collapsing to "f-hrung".
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')
  return slug === '' ? 'dashboard' : slug
}

function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  // Starts at 2, so the second "Speaker Tracking" is `speaker-tracking-2`. There is no cap:
  // `taken` grows every iteration, so this terminates on the first free suffix.
  let suffix = 2
  while (taken.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

function compareDashboards(left: DashboardOf, right: DashboardOf): number {
  if (left.order !== right.order) return left.order - right.order
  const byName = left.name.localeCompare(right.name)
  return byName === 0 ? left.id.localeCompare(right.id) : byName
}
