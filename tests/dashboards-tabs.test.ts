// The dashboard tab strip, ref 34. Every test here is about something the screen cannot show
// you: the order the tabs come out in, the slug each one answers to, and the collision rules.
// A strip that renders correctly while linking to the wrong dashboard looks like a strip that
// works.

import { describe, expect, it } from 'vitest'
import { DASHBOARD_COLOR_ITEMS } from '@/features/dashboard/DashboardDot'
import {
  dashboardSlug,
  dashboardTabBySlug,
  dashboardTabs,
  TODAY_TAB_COLOR,
  TODAY_TAB_ID,
} from '@/features/dashboard/dashboard-tabs'
import { HOME_TABS } from '@/features/dashboard/sub-tabs'
import { DASHBOARD_COLORS } from '@/services/airtable/mapping-dashboards'

const dashboard = (id: string, name: string, order: number) =>
  ({ id, name, color: 'purple', order }) as const

describe('dashboardTabs', () => {
  it('puts Today first with its own dot and the bare event home URL', () => {
    const tabs = dashboardTabs('ev1', [])

    expect(tabs).toEqual([
      {
        id: TODAY_TAB_ID,
        label: 'Today',
        slug: TODAY_TAB_ID,
        href: '/admin/ev1',
        color: TODAY_TAB_COLOR,
      },
    ])
  })

  it('orders custom dashboards by order and then by name', () => {
    const tabs = dashboardTabs('ev1', [
      dashboard('rec3', 'Speaker Tracking', 2),
      dashboard('rec2', 'Review Progress', 1),
      // Same order as Review Progress, so the name decides and the strip cannot reshuffle
      // between requests.
      dashboard('rec1', 'Agenda Health', 1),
    ])

    expect(tabs.map((tab) => tab.label)).toEqual([
      'Today',
      'Agenda Health',
      'Review Progress',
      'Speaker Tracking',
    ])
  })

  it('routes a custom dashboard at /dashboard/{slug} derived from its name', () => {
    const tabs = dashboardTabs('ev1', [dashboard('rec1', 'Submissions Pipeline', 1)])

    expect(tabs.at(1)).toEqual({
      id: 'rec1',
      dashboardId: 'rec1',
      label: 'Submissions Pipeline',
      slug: 'submissions-pipeline',
      href: '/admin/ev1/dashboard/submissions-pipeline',
      color: 'purple',
    })
  })

  it('keeps a dashboard reachable when its name collides with a Today sub-tab', () => {
    // `/dashboard/participants` is Today's Participants sub-tab (ref 36) and the route resolves
    // that first, so this dashboard has to answer to something else or it is unreachable.
    const tabs = dashboardTabs('ev1', [dashboard('rec1', 'Participants', 1)])

    expect(tabs.at(1)?.slug).toBe('participants-2')
    expect(HOME_TABS.some((tab) => tab.id === 'participants')).toBe(true)
  })

  it('suffixes two dashboards with the same name by position', () => {
    const tabs = dashboardTabs('ev1', [
      dashboard('rec1', 'Speaker Tracking', 1),
      dashboard('rec2', 'Speaker Tracking', 2),
      dashboard('rec3', 'Speaker Tracking', 3),
    ])

    expect(tabs.slice(1).map((tab) => tab.slug)).toEqual([
      'speaker-tracking',
      'speaker-tracking-2',
      'speaker-tracking-3',
    ])
  })

  it('never emits the Today slug for a custom dashboard', () => {
    const tabs = dashboardTabs('ev1', [dashboard('rec1', 'Today', 1)])

    expect(tabs.at(1)?.slug).toBe('today-2')
    expect(tabs.filter((tab) => tab.slug === TODAY_TAB_ID)).toHaveLength(1)
  })
})

describe('dashboardSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(dashboardSlug('Evaluation Plans by Tracks')).toBe('evaluation-plans-by-tracks')
  })

  it('collapses punctuation instead of doubling hyphens', () => {
    expect(dashboardSlug('  Q3 // Review: speakers!  ')).toBe('q3-review-speakers')
  })

  it('keeps non-ASCII letters rather than eating them', () => {
    // A `[^a-z0-9]` character class would have turned this into `f-hrung`.
    expect(dashboardSlug('Führung')).toBe('führung')
  })

  it('falls back to dashboard for a name with no letters or digits', () => {
    expect(dashboardSlug('***')).toBe('dashboard')
  })
})

describe('dashboardTabBySlug', () => {
  const tabs = dashboardTabs('ev1', [dashboard('rec1', 'Speaker Tracking', 1)])

  it('finds the tab a URL segment selects', () => {
    expect(dashboardTabBySlug(tabs, 'speaker-tracking')?.dashboardId).toBe('rec1')
  })

  it('answers undefined for an unknown slug so the route can 404', () => {
    expect(dashboardTabBySlug(tabs, 'nope')).toBeUndefined()
  })
})

describe('a rename moves the tab URL', () => {
  // Why `updateDashboardAction` hands back an `href` instead of letting the client refresh in
  // place. The slug is a function of the name, so renaming a dashboard invalidates the segment
  // the organizer is standing on, and an unresolvable admin segment answers HTTP 200 with the
  // 404 body on Workers: the rename looked like it had deleted the dashboard. Found by Codex
  // review. The action substitutes the new name into the list it already read and recomputes the
  // strip, which is exactly what is asserted here.
  const before = [dashboard('rec1', 'Speaker Tracking', 1), dashboard('rec2', 'Review Progress', 2)]
  const renamed = before.map((row) => (row.id === 'rec1' ? { ...row, name: 'Cast' } : row))

  it('gives the renamed dashboard the slug of its new name', () => {
    expect(dashboardTabBySlug(dashboardTabs('ev1', before), 'speaker-tracking')?.dashboardId).toBe(
      'rec1',
    )

    const after = dashboardTabs('ev1', renamed)
    expect(after.find((tab) => tab.dashboardId === 'rec1')?.href).toBe('/admin/ev1/dashboard/cast')
    // And the URL it used to answer to now resolves to nothing, which is the whole problem.
    expect(dashboardTabBySlug(after, 'speaker-tracking')).toBeUndefined()
  })

  it('leaves the URL of every other tab alone', () => {
    const after = dashboardTabs('ev1', renamed)

    expect(after.find((tab) => tab.dashboardId === 'rec2')?.href).toBe(
      '/admin/ev1/dashboard/review-progress',
    )
  })
})

describe('DASHBOARD_COLOR_ITEMS', () => {
  it('covers exactly the stored colour vocabulary', () => {
    // The Settings dialog is a client component and takes its options from DashboardDot.tsx
    // rather than from the schema module, so this is the pin that keeps the two lists equal.
    expect(DASHBOARD_COLOR_ITEMS.map((item) => item.value)).toEqual([...DASHBOARD_COLORS])
  })
})
