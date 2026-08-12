// The guard on the two GETs that change session state.
//
// `/logout` and `/admin-mode` mutate the session on a GET, which is kept only because
// signing out has to work with scripting off. The session cookie is SameSite=Lax, which
// withholds it from a cross-site subresource but SENDS it on a cross-site top-level
// navigation, so without this a link from another origin could sign somebody out or push an
// impersonated organizer back into admin mode. Found by Codex review.

import { describe, expect, it } from 'vitest'

import { startedOnThisSite } from '@/features/auth/same-site'

const withSite = (value: string | null) => ({
  headers: { get: (name: string) => (name === 'sec-fetch-site' ? value : null) },
})

describe('startedOnThisSite', () => {
  it('allows a request from this exact origin', () => {
    expect(startedOnThisSite(withSite('same-origin'))).toBe(true)
  })

  it('refuses same-site, because SameSite protects sites and not origins', () => {
    // The correction Codex raised on the first version of this guard: a different origin on
    // the same registrable domain both carries the Lax cookie AND reports `same-site`, so
    // allowing it left the hole open to any sibling subdomain. Nothing here links to either
    // endpoint from another origin, so refusing costs nothing.
    expect(startedOnThisSite(withSite('same-site'))).toBe(false)
  })

  it('allows a navigation the person started outside any page', () => {
    // What a browser reports for a typed URL or a bookmark. That is a deliberate act by the
    // owner of the session, which is exactly what this is protecting rather than blocking.
    expect(startedOnThisSite(withSite('none'))).toBe(true)
  })

  it('refuses a cross-site navigation, which is the attack', () => {
    expect(startedOnThisSite(withSite('cross-site'))).toBe(false)
  })

  it('allows a client that sends no header at all', () => {
    // Deliberate, and the reasoning is in the module: refusing would mean such a browser
    // could never sign out, and being unable to END a session is worse than ending one
    // unexpectedly.
    expect(startedOnThisSite(withSite(null))).toBe(true)
    expect(startedOnThisSite(withSite(''))).toBe(true)
  })
})
