// Speaker portal shell. No admin sidebar: a speaker sees a centred page with a pill
// nav, per docs/parity/speaker-portal.md.
//
// The chrome itself is `PortalFrame`, which each page renders rather than this layout:
// `pageTitle` and `activeNav` differ per page (Home, Submissions, Profile, Tasks) and a
// layout has no way to know which pill is active. So this file is only the two things
// that are true for the whole surface: the data port and the login check.
//
// Both used to live in a `PortalGuard` component rendered inside `<Suspense>`, because
// reading the session cookie in a layout body made every route under this tree
// unprerenderable while `cacheComponents` was on. That shape was wrong on Workers as
// well as roundabout: `redirect()` from inside a boundary resolves after the shell has
// flushed, and a redirect at that point never produces a response. The flag is off now
// (next.config.ts), so the cookie read is ordinary and the redirect is issued before the
// first byte.
//
// The redirect is a convenience for a browser and NOT the security boundary. A Server
// Action is reachable by POST without this ever rendering, so every portal mutation
// authorizes for itself and verifies record ownership: see src/features/portal/actions.ts
// and src/features/portal/authorize.ts. BUILD_SPEC 4.

import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { DemoBanner } from '@/components/shell/DemoBanner'
import { isAppError } from '@/constants/errorIds'
import { requireSpeaker } from '@/features/auth/wiring'
import { portalEventId } from '@/features/portal/event-scope'
import { installPortalData } from '@/features/portal/wiring'

export default async function PortalLayout({ children }: { children: ReactNode }) {
  // Installs the real data port. Here because the layout runs on every portal route, so
  // one call covers the whole surface, and because a page that forgot would silently
  // read empty lists rather than fail.
  installPortalData()

  if (!(await hasSpeakerSession())) {
    redirect('/login?next=%2Fportal')
  }

  // Resolved HERE, in the layout body, purely so that a misconfiguration is loud.
  //
  // `portalEventId()` throws CFG_ENV_MISSING when `PORTAL_EVENT_ID` is unset against a
  // real base, and every page below calls it from inside a `<Suspense>` boundary. A throw
  // in there never reaches the visitor as an error: the boundary resolves after the shell
  // has flushed, so the card renders with no rows AND no empty-state copy, which reads
  // exactly like a speaker who has submitted nothing. That is what made the speaker's own
  // submissions list look broken rather than misconfigured, and it took the edit round
  // trip down with it, because nobody could reach a submission to open one.
  //
  // Called before the first byte, the same throw is an ordinary 500 that names the
  // variable. The value is discarded on purpose: every page reads it again where it is
  // needed, and this call exists for its failure rather than its result.
  //
  // AFTER the session read, not before, and that ordering is load-bearing at BUILD time.
  // The cookie read is what tells Next this subtree is dynamic; until it happens the
  // prerender is still running with no request and no Worker vars, so a throw above it is
  // not a loud 500, it is `next build` exiting on
  // "Export encountered an error on /(portal)/portal/profile/page". `PORTAL_EVENT_ID`
  // lives on the deployed Worker and deliberately not in `.env.local`, so the build box
  // is exactly the environment this check is designed to reject.
  portalEventId()

  // The chrome is each page's own `PortalFrame`, so this is the one wrapper the whole
  // surface shares and therefore where a deployment-wide notice belongs. It renders
  // nothing when demo mode is off.
  return (
    <>
      <DemoBanner />
      {children}
    </>
  )
}

async function hasSpeakerSession(): Promise<boolean> {
  try {
    await requireSpeaker()
    return true
  } catch (error) {
    // Every AUTH_* failure means the same thing here: go and log in. An admin session
    // is one of them, because the portal is a speaker surface (guards.ts refuses a
    // `user` subject) and impersonation works by holding a speaker session.
    if (isAppError(error) && error.id.startsWith('E_AUTH')) return false
    throw error
  }
}
