// The sub-tab strip's labels, order and URLs, ref 34 and ref 37.
//
// Pinned in a test because all three are parity, and all three are invisible to type
// checking: a renamed label, a reordered strip or a changed slug all compile.

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_HOME_TAB,
  HOME_TABS,
  homeTabFromSlug,
  homeTabHref,
} from '@/features/dashboard/sub-tabs'

describe('HOME_TABS', () => {
  it('is ref 34 verbatim, in order, with Submission Forms selected first', () => {
    expect(HOME_TABS.map((tab) => tab.label)).toEqual([
      'Submission Forms',
      'Participants',
      'Evaluations',
      'Agenda',
    ])
    expect(DEFAULT_HOME_TAB).toBe('submission-forms')
  })
})

describe('homeTabHref', () => {
  it('matches the URL ref 37 captured in the address bar', () => {
    // `appv2.sessionboard.com/event/6703/dashboard/evaluations`, so the sub-tab is a route
    // segment and not a query string or client state.
    expect(homeTabHref('recEvent1', 'evaluations')).toBe('/admin/recEvent1/dashboard/evaluations')
    expect(homeTabHref('recEvent1', 'participants')).toBe('/admin/recEvent1/dashboard/participants')
    expect(homeTabHref('recEvent1', 'agenda')).toBe('/admin/recEvent1/dashboard/agenda')
  })

  it('leaves the default tab on the bare event home', () => {
    // Which is where the sidebar's Dashboard item and every existing link already point.
    expect(homeTabHref('recEvent1', 'submission-forms')).toBe('/admin/recEvent1')
  })

  it('keeps two events apart', () => {
    expect(homeTabHref('recA', 'agenda')).not.toBe(homeTabHref('recB', 'agenda'))
  })
})

describe('homeTabFromSlug', () => {
  it('resolves every strip slug, including the default tab a shared URL may carry', () => {
    for (const tab of HOME_TABS) {
      expect(homeTabFromSlug(tab.id)).toBe(tab.id)
    }
  })

  it('does not guess at an unknown segment', () => {
    // The route 404s on this rather than silently rendering the Submission Forms panel under
    // a URL that claims to be something else.
    expect(homeTabFromSlug('speakers')).toBeUndefined()
    expect(homeTabFromSlug('')).toBeUndefined()
  })
})
