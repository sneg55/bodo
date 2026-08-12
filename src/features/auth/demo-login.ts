// Click-to-sign-in for the demo deployment and for local debugging.
//
// The magic link is the real login and this does not replace it. It replaces the
// MAILBOX, for the two situations where there isn't one: a public demo where a
// visitor has no address on this deployment, and a developer who would otherwise be
// grepping a sign-in link out of the server log.
//
// One property holds the whole feature together, and every review of this file
// should check it first:
//
//   **Demo mode changes how a visitor proves who they are. It never changes who
//   exists.**
//
// So resolution goes through `resolveLoginSubject`, the same function the magic link
// uses, against the same AdminUsers and Speakers rows. There is no synthetic subject
// and no create-on-demand path. A `DEMO_ADMIN_EMAIL` pointing at an address with no
// row signs nobody in; it raises, and /login says the demo is misconfigured. That is
// what keeps "anyone may click this button" bounded by the seeded data rather than
// open-ended, and it is why enabling demo mode against a real base grants exactly the
// three identities named in the environment and no others.
//
// Everything is injected, for the same reason guards.ts and magic-link.ts inject:
// `src/features/auth` does not import `src/services/airtable`, and the cases worth
// testing (an unresolvable address, an admin with no membership, the destination each
// persona lands on) are then reachable without a network or a request scope.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { chooseAdminLanding, type LandingEventReader } from '@/features/auth/landing'
import type { SessionEstablisher, SubjectResolver } from '@/features/auth/magic-link'
import type { EventMembership, RecordId } from '@/types/domain'

/** The route handler the /login buttons post to. */
export const DEMO_LOGIN_PATH = '/api/auth/demo'

/** Which seeded identity a button signs in as. */
export type DemoPersona = 'admin' | 'reviewer' | 'speaker'

const PERSONAS: readonly DemoPersona[] = ['admin', 'reviewer', 'speaker']

export function isDemoPersona(value: string): value is DemoPersona {
  return (PERSONAS as readonly string[]).includes(value)
}

/**
 * Which login audience a persona resolves through.
 *
 * `admin` and `reviewer` are both `user` subjects and differ only in the role their
 * EventMemberships row carries, which is exactly right: capability comes from
 * memberships per request and never from how the session was established (BUILD_SPEC
 * §4). A reviewer button that minted anything more than a `user` subject would be
 * inventing a capability, so it mints the same thing the admin button does and the
 * seeded membership decides what that identity can actually see.
 */
export function audienceFor(persona: DemoPersona): 'admin' | 'speaker' {
  return persona === 'speaker' ? 'speaker' : 'admin'
}

/** Every membership for one admin user. `listMembershipsForUser` from the DAL. */
export type MembershipReader = (userId: RecordId) => Promise<readonly EventMembership[]>

/** Exactly what `demoIdentityEmails()` in src/utils/env.ts returns. */
export type DemoEmails = { admin: string; reviewer: string; speaker: string }

/**
 * Spelled out rather than indexed by `persona`, which is what
 * `security/detect-object-injection` exists to stop. Three branches also mean adding a
 * persona fails to compile here until its address is decided.
 */
export function emailFor(persona: DemoPersona, emails: DemoEmails): string {
  if (persona === 'admin') return emails.admin
  if (persona === 'reviewer') return emails.reviewer
  return emails.speaker
}

export type DemoSignIn = {
  /** Where to send the browser, always a same-site path. */
  destination: string
}

/**
 * Sign in as `persona` and report where to land.
 *
 * No `claimOnce` and no token: there is nothing single-use about a button that is
 * meant to be pressed by every visitor, so the single-use machinery the magic link
 * needs has nothing to protect here.
 */
export async function signInAsDemoPersona(options: {
  persona: DemoPersona
  emails: DemoEmails
  nowMs: number
  resolveSubject: SubjectResolver
  establish: SessionEstablisher
  loadMemberships: MembershipReader
  /** How to read an event's status and slug, for ranking the landing. See ./landing.ts. */
  readEvent: LandingEventReader
}): Promise<DemoSignIn> {
  const { persona, emails, nowMs } = options
  const audience = audienceFor(persona)
  const email = emailFor(persona, emails).trim().toLowerCase()

  const subject = await options.resolveSubject({ email, audience })
  if (subject === undefined) {
    // Named in the message because this is an operator reading their own logs about
    // their own configuration, not a stranger probing for accounts. The public page
    // above still says only that the demo is misconfigured.
    throw new AppError(
      ErrorIds.AUTH_DEMO_IDENTITY_MISSING,
      `demo ${persona} is configured as an address with no ${audience === 'admin' ? 'AdminUsers' : 'Speakers'} row`,
      { persona, audience },
    )
  }

  // Resolved BEFORE the session is written, so a misconfigured admin persona leaves
  // the visitor signed out on /login rather than signed in and staring at a 404.
  const destination =
    subject.kind === 'user'
      ? await adminDestination({
          userId: subject.userId,
          persona,
          load: options.loadMemberships,
          readEvent: options.readEvent,
        })
      : '/portal'

  // Marked, so turning DEMO_MODE off actually revokes this session instead of only
  // hiding the button that minted it. `currentSubject` in session.ts is what refuses it.
  await options.establish({ subject: { ...subject, viaDemo: true }, nowMs })
  return { destination }
}

/**
 * The event an admin persona lands on, decided by `chooseAdminLanding` and nothing local.
 *
 * **This used to be `memberships.at(0)` addressed by record id, and both halves were wrong.**
 * `/admin` had already been fixed to rank the liveliest event and to address it by slug, but
 * the demo BUTTON is the door nearly every visitor uses, and it never ran that code: it took
 * whatever order Airtable returned and produced `/admin/recHnUyjJXap9POSM`. So the entry point
 * most likely to be seen was the one that could drop somebody on a near-empty draft, with the
 * unreadable URL that then propagated through the whole session, because the sidebar builds
 * its links from what the URL already carries.
 *
 * An admin with no membership at all has nowhere in the admin app to be, and that is a seeding
 * mistake worth failing on rather than a 404 to walk into.
 *
 * WHICH page it lands on depends on the role the membership carries (`adminLandingPath`).
 * `/admin/{id}` is the organizer dashboard, so the reviewer persona used to sign in and
 * arrive on the "Reviewer access" refusal card every single time: their landing page was a
 * notice telling them where their landing page was.
 */
async function adminDestination(options: {
  userId: RecordId
  persona: DemoPersona
  load: MembershipReader
  readEvent: LandingEventReader
}): Promise<string> {
  const memberships = await options.load(options.userId)
  const destination = await chooseAdminLanding(memberships, options.readEvent)
  if (destination === undefined) {
    throw new AppError(
      ErrorIds.AUTH_DEMO_IDENTITY_MISSING,
      `demo ${options.persona} holds no event membership, so there is no admin surface to land on`,
      { persona: options.persona, userId: options.userId },
    )
  }
  return destination
}
