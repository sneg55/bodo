// Which events the portal is showing.
//
// It used to be one, from configuration, and the header here said why: the portal URLs carry
// no event id (the pill nav is Home / Submissions / Profile / Tasks at `/portal/*`,
// docs/parity/speaker-portal.md), the session token carries only a subject id and its kind
// (no role, no event, deliberately: src/features/auth/tokens.ts), and "the DAL has no
// 'events for this speaker' read, so there is nothing to derive the scope from at request
// time".
//
// That last clause was the whole argument, and it is no longer true:
// `listEventIdsForSpeaker` is that read. Leaving it as configuration cost a real defect. The
// eval run of 2026-08-10 filed it as major: a proposal submitted through the public CFP
// never reached the submitter's portal, /portal and /portal/submissions listed only their
// older submissions, /portal/submissions/SESS-35 answered a genuine 404, and the account
// menu offered no event switcher, all while the confirmation page told them to track it
// there. The submission was fine. The scope was wrong.
//
// So the scope is now derived from the speaker, and `PORTAL_EVENT_ID` keeps exactly one job:
// naming the event a speaker with NO events yet should be shown, which is what the sign-in
// landing and the empty state need. The two are different questions and conflating them is
// what produced the defect.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { FIXTURE_EVENT } from '@/services/airtable/fixtures'
import { listEventIdsForSpeaker } from '@/services/airtable/reads-speaker-events'
import { getEnv, hasAirtable } from '@/utils/env'

/**
 * The configured event.
 *
 * Still the answer for the surfaces that genuinely have only one: the portal's own default
 * landing context, the file-upload route's event link, and the reminder sweep's fallback
 * when the base cannot be listed. NOT the answer for "what may this speaker see".
 *
 * The two branches are not symmetrical on purpose. With no Airtable base the app is serving
 * fixtures and must still boot and demo, so the fixture event is the answer. With a real
 * base, guessing would mean showing one event's submissions inside another event's portal,
 * so an unset `PORTAL_EVENT_ID` fails loudly instead.
 */
export function portalEventId(): string {
  const configured = getEnv().PORTAL_EVENT_ID
  if (configured !== undefined) return configured

  if (hasAirtable()) {
    throw new AppError(
      ErrorIds.CFG_ENV_MISSING,
      'PORTAL_EVENT_ID is required once AIRTABLE_BASE_ID is set: the portal cannot guess which event it serves',
    )
  }
  return FIXTURE_EVENT.id
}

/**
 * The rule, separated from the read so it can be tested without a base.
 *
 * A speaker linked to no event at all falls back to the configured one. That is not a
 * courtesy: an invited speaker whose record exists before their first submission has no
 * event links yet, and showing them an empty portal with no event context would break the
 * profile and task pages, which need an event to resolve their own config against.
 *
 * The configured event is NOT added to a speaker who does have events. Doing that would put
 * every speaker back in one shared conference, which is the defect this file exists to fix.
 */
export function portalScopeOf(
  linked: readonly string[],
  fallbackEventId: string,
): readonly string[] {
  return linked.length === 0 ? [fallbackEventId] : linked
}

/**
 * Every event this speaker may be shown, resolved at request time.
 *
 * This is an AUTHORIZATION boundary and not merely a filter: the set a portal read is scoped
 * to is the set that read may return, so nothing downstream may widen it. Same rule the CRM
 * states for `CrmScope.eventIds`.
 */
export async function portalEventIds(speakerId: string): Promise<readonly string[]> {
  return portalScopeOf(await listEventIdsForSpeaker(speakerId), portalEventId())
}

/**
 * ONE event out of that scope, for a write that needs an event and has no record to take
 * it from.
 *
 * The profile save is the case, and the only one: a Speakers row is not event-scoped, so
 * `saveSpeakerProfile` takes an `eventId` purely to seed the tags it expires (it unions the
 * row's own event links on top). Passing `portalEventId()` there named the configured
 * event's caches for a speaker who may not be in it, and named none of their own.
 *
 * The first of the speaker's own events, which for a speaker with none is the configured
 * one by way of `portalScopeOf`. Never a guess: the scope is never empty, and the fallback
 * below exists only because an array index is typed as possibly absent.
 */
export async function speakerHomeEventId(speakerId: string): Promise<string> {
  const scope = await portalEventIds(speakerId)
  return scope[0] ?? portalEventId()
}
