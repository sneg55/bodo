// Where the auth feature meets the data layer.
//
// `src/features/auth/guards.ts` deliberately imports nothing from
// `src/services/airtable`: it takes a membership loader so it stays unit-testable
// and so the two could be written in parallel. That indirection has to be resolved
// exactly once, and this is the file that does it. Route code calls the guards
// exported here and never repeats the wiring, because a guard wired differently at
// one call site is an authorization hole that looks like a copy-paste.
//
// Everything here is server-only: it reads the session cookie and it reads
// Airtable. There is no `server-only` import guard because the package is not a
// dependency and adding one for a marker is not worth it; what actually prevents
// client use is that `next/headers` throws outside a request scope, so a client
// component importing this fails loudly rather than leaking.

import type { EventRole } from '@/constants/status'
import type { AdminIdentity, SpeakerIdentity } from '@/features/auth/guards'
import {
  createEventRoleGuards,
  requireAdminUser as requireAdminUserBase,
  requireSession as requireSessionBase,
  requireSpeaker as requireSpeakerBase,
} from '@/features/auth/guards'
import { beginImpersonation, endImpersonation, type RoleCheck } from '@/features/auth/impersonation'
import { currentSubject, establishSession } from '@/features/auth/session'
import type { SessionSubject } from '@/features/auth/tokens'
import { resolveEventRef } from '@/features/events/resolve-ref'
import { portalEventId } from '@/features/portal/event-scope'
import { getSpeaker, listMembershipsForUser, listSpeakers } from '@/services/airtable/queries'
import { claimOnce } from '@/utils/cf'

const { requireEventRole: requireEventRoleBase, eventRoleOf: eventRoleOfBase } =
  createEventRoleGuards({ loadMemberships: listMembershipsForUser })

/**
 * One instant per request. Every guard takes `nowMs` rather than reading the clock
 * so token expiry stays testable, which means the entry point has to supply it, and
 * supplying it here keeps `Date.now()` out of every page and action.
 *
 * This used to be `async` and start with `await connection()`, because under
 * `cacheComponents` `Date.now()` was an unstable value: reading it while a route was
 * being prerendered failed the build, and `connection()` was the documented way to say
 * "this is request time, stop prerendering". Cache Components is off now
 * (next.config.ts), nothing here is prerendered, and the clock is just the clock, so
 * the indirection and the async-for-no-reason it forced on every guard are both gone.
 */
function now(): number {
  return Date.now()
}

export async function requireSession(): Promise<SessionSubject> {
  return await requireSessionBase({ nowMs: now() })
}

/**
 * Whether this request carries a usable session, without demanding one.
 *
 * For a public surface that has to behave differently for a signed-in visitor and a
 * stranger without refusing either. The CFP success card is the case it was added for:
 * "Continue to portal" is right for a speaker who is already signed in, and is a bounce
 * to the login page for the first-time submitter who has just typed their email into a
 * public form. Typing an address into a form is not authentication, so this reports the
 * session rather than creating one.
 */
export async function hasSession(): Promise<boolean> {
  return (await currentSubject({ nowMs: now() })) !== undefined
}

export async function requireSpeaker(): Promise<SpeakerIdentity> {
  return await requireSpeakerBase({ nowMs: now() })
}

/**
 * The subject on this request, or undefined. The un-narrowed form of `hasSession` above.
 *
 * For a PUBLIC surface that has to decide something from WHO is signed in rather than from
 * whether anyone is: the CFP submit compares it against the Speakers row an address already
 * names, through `submitterBinding`. Never throws, because a public entry point must treat
 * an expired or tampered cookie as "not signed in" rather than as an error.
 */
export async function sessionSubject(): Promise<SessionSubject | undefined> {
  return await currentSubject({ nowMs: now() })
}

/**
 * The speaker this request is acting as, without demanding one, and never throwing.
 *
 * `hasSession` above answers "is anybody signed in", which is all the success card needed.
 * The public CFP needs the stronger fact: WHICH speaker record this browser has proved it
 * controls, because that is what `submitterBinding` compares an existing Speakers row
 * against before a submission is allowed to attach itself to it. See
 * ./submitter-identity.ts for the hole that check closes.
 *
 * The email comes from the record rather than from the session, and it has to: the token
 * carries a record id and nothing else (see `mintSessionToken`), on purpose, so an address
 * baked into a 30 day cookie cannot go stale against a profile edit.
 *
 * An ADMIN session returns undefined here rather than an error. A public page is allowed to
 * be visited by an organizer, and "no speaker identity on this request" is the honest answer.
 *
 * A session naming a record that is no longer there reads the same way. `getSpeaker` is a
 * direct record fetch (reads-review.ts) and Airtable answers 404 for a deleted id, which the
 * client throws on; a cookie is good for 30 days, so that outcome outlives the record, and a
 * PUBLIC call for papers must not 500 because a visitor still has an old one.
 */
export async function sessionSpeaker(): Promise<{ speakerId: string; email: string } | undefined> {
  const subject = await sessionSubject()
  if (subject?.kind !== 'speaker') return undefined
  try {
    const speaker = await getSpeaker(subject.speakerId)
    return { speakerId: subject.speakerId, email: speaker.email }
  } catch {
    return undefined
  }
}

export async function requireAdminUser(): Promise<AdminIdentity> {
  return await requireAdminUserBase({ nowMs: now() })
}

/**
 * Assert a capability on one event. Throws `AUTH_FORBIDDEN_ROLE` when the user has
 * no membership or a weaker one, and returns the role actually held so a surface
 * can decide what to render (a reviewer sees Evaluation, an admin sees everything).
 *
 * Call this in the Server Action or Route Handler, not only in the layout. A layout
 * is not a security boundary: a Next app has multiple entry points and a layout
 * does not revalidate on every navigation.
 */
export async function requireEventRole(
  eventId: string,
  role: EventRole,
): Promise<AdminIdentity & { role: EventRole }> {
  return await requireEventRoleBase({ nowMs: now(), eventId: await eventRecordId(eventId), role })
}

/** The role held, or undefined. For rendering decisions, never for access. */
export async function eventRoleOf(eventId: string): Promise<EventRole | undefined> {
  return await eventRoleOfBase({ nowMs: now(), eventId: await eventRecordId(eventId) })
}

/**
 * Accept a slug wherever a record id is accepted, at the one door every Server Action and
 * both admin layout guards already pass through.
 *
 * This is what lets `/admin/<slug>/...` work without touching the sixteen components that
 * hold a single `eventId` value and use it BOTH to build an href and to invoke an action
 * (FormCard, EmbedEditor, AgendaSurface, EventSwitcher and twelve more). Splitting that prop
 * in all of them is the version of this change that is neither cheap nor safe; resolving
 * here means none of them changes and none of them can get it wrong.
 *
 * An unresolvable ref is passed through UNCHANGED rather than raising its own error. A slug
 * no event holds carries no membership either, so the caller's own check refuses it with
 * `AUTH_FORBIDDEN_ROLE` naming the ref that was asked for, which is the same answer a real
 * event the caller has no role on already gets. Inventing a second failure mode here would
 * let a prober tell "no such event" apart from "not your event".
 */
async function eventRecordId(ref: string): Promise<string> {
  return (await resolveEventRef(ref)) ?? ref
}

/**
 * The same role check, for a subject that is NOT the one on the request.
 *
 * Exists for one caller: leaving impersonation, which has to ask whether the admin named
 * by the session's claim still holds `admin`, while the session itself is a speaker. It is
 * the ordinary guard with an explicit subject, so the answer still comes from
 * EventMemberships on this request and never from the cookie.
 */
const requireEventRoleFor: RoleCheck = async (options) =>
  await requireEventRoleBase({ nowMs: now(), ...options })

/**
 * An unguessable id, from the platform's CSPRNG rather than anything derived from the
 * session, so a grant cannot be predicted from a cookie somebody already holds.
 */
function newGrantId(): string {
  return crypto.randomUUID()
}

/**
 * Enter the portal as one of the event's speakers. Authorizes as `admin` on the event,
 * checks the target is really a speaker there, then replaces the session.
 */
export async function enterPortalAsSpeaker(input: {
  eventId: string
  speakerId: string
}): Promise<{ userId: string; speakerId: string }> {
  return await beginImpersonation({
    eventId: input.eventId,
    speakerId: input.speakerId,
    portalEventId: portalEventId(),
    // Resolved here rather than left to the role check's own cookie read, which is what
    // `leavePortalImpersonation` below already does. `beginImpersonation` needs the
    // acting session itself, not just its authorization, so that a demo-issued organizer
    // session does not launder its `viaDemo` mark off by stepping into the portal.
    subject: await requireSessionBase({ nowMs: now() }),
    nowMs: now(),
    requireEventRole: requireEventRoleFor,
    listEventSpeakers: listSpeakers,
    establish: establishSession,
    newGrantId: newGrantId,
  })
}

/**
 * `Back to Admin Mode`. Returns the event to land on as well as the restored user, since
 * the caller has to redirect somewhere and the portal's event is where they came from.
 */
export async function leavePortalImpersonation(): Promise<{ userId: string; eventId: string }> {
  const eventId = portalEventId()
  const { userId } = await endImpersonation({
    eventId,
    subject: await requireSessionBase({ nowMs: now() }),
    nowMs: now(),
    requireEventRole: requireEventRoleFor,
    establish: establishSession,
    claim: claimOnce,
    newGrantId: newGrantId,
  })
  return { userId, eventId }
}
