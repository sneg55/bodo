// Turning an `Authorization` header into "which events may this request see, and AS WHAT".
//
// **Capability comes from `EventMemberships`, never from the token row.** That is the same
// rule BUILD_SPEC section 4 states for the session cookie, and it matters more here, not
// less: a token has no expiry, so an event list baked into it at creation would still be
// granting access to an event the owner was removed from months later. The token identifies
// a PERSON; the memberships decide what that person reaches, on every request.
//
// **The ROLE travels with each event, and dropping it was a privilege escalation.** This used
// to map every membership to a bare id, which made "member of" the only question the API could
// ask. A user who is `admin` on event A and `reviewer` on event B could then mint a token from
// A's settings page and read B through any organizer-only surface the API offers, because the
// difference between the two memberships no longer existed by the time a tool looked. Roles
// are kept per event so a tool can require `admin` on the event it was asked about.
//
// Every refusal is the same 401 with the same body. "No such token", "revoked token", "token
// whose owner lost every membership" and "token carrying no usable scope" are four different
// facts to us and one fact to a client, and telling them apart out loud would let a prober use
// the API as an oracle.

import type { EventRole } from '@/constants/status'
import { bearerToken, hashToken } from '@/features/api/token-rules'
import { roleSatisfies } from '@/features/auth/guards'
import { touchApiToken } from '@/services/airtable/mutations-api'
import { listMembershipsForUser } from '@/services/airtable/queries'
import { findApiToken } from '@/services/airtable/reads-api'
import type { ApiScope, ApiToken } from '@/types/api-token'

/** One event the owner holds a membership on, with the role held on THAT event. */
export type ApiCallerEvent = { readonly id: string; readonly role: EventRole }

export type ApiCaller = {
  readonly tokenId: string
  readonly userId: string
  readonly scopes: readonly ApiScope[]
  /** Every event the owner holds a membership on, and the role held on each. */
  readonly events: readonly ApiCallerEvent[]
  /**
   * The ids of `events`, kept because most reads only intersect and would otherwise map the
   * list at each call site. Derived from `events`, so it can never name an event that list
   * does not: the two cannot drift because one is computed from the other.
   */
  readonly eventIds: readonly string[]
}

/**
 * The scope every `/api/v1` and MCP request needs, checked once, here.
 *
 * v1 issues `read` and nothing else, so every endpoint has the same floor and a per-route
 * check would be the same line copied five times, with the sixth route free to forget it.
 * That forgetting is what this is fixing: `hasScope` existed and nothing called it, so a row
 * whose `scopes` cell was blank, or held only strings `parseScopes` does not recognise,
 * authenticated with full access. When a write scope arrives it will be an ADDITIONAL check in
 * the route that writes, on top of this floor, not a replacement for it.
 */
const REQUIRED_SCOPE: ApiScope = 'read'

/**
 * The caller behind this request, or `undefined` for anything that does not authenticate.
 *
 * The `lastUsedAt` stamp IS awaited. It costs one Airtable write on the API path, and it buys
 * a column that is actually true: its only job is telling an organizer which of five tokens is
 * live before they revoke one, and a fire-and-forget write cannot do that job on Workers, where
 * the isolate may be torn down the moment the response is returned. A stamp that lands
 * sometimes is worse than no column, because it reads as "this token is unused". A FAILED
 * stamp is still swallowed: an audit write must not turn an otherwise fine request into a 401.
 */
export async function authenticate(
  request: Request,
  now: () => string = () => new Date().toISOString(),
): Promise<ApiCaller | undefined> {
  const presented = bearerToken(request.headers.get('authorization'))
  if (presented === undefined) return undefined

  const token = await findApiToken(await hashToken(presented))
  if (token === undefined || token.revokedAt !== undefined) return undefined
  if (token.ownerId === undefined) return undefined

  const memberships = await listMembershipsForUser(token.ownerId)
  // No memberships is a 401 rather than an empty result set, because a token that can reach
  // nothing is indistinguishable in effect from one that does not authenticate, and saying
  // so plainly is less confusing than 200 with an empty list on every endpoint.
  if (memberships.length === 0) return undefined

  const events = memberships.map((membership) => ({
    id: membership.eventId,
    role: membership.role,
  }))
  const caller: ApiCaller = {
    tokenId: token.id,
    userId: token.ownerId,
    scopes: token.scopes,
    events,
    eventIds: events.map((event) => event.id),
  }
  // Scope alone, NOT `scope || no memberships`. An `&&` here would only refuse a token that
  // was both unscoped and reached nothing, which is to say it would refuse almost nothing:
  // any row with a blank or unrecognised `scopes` cell but a live membership would still
  // authenticate with full access, which is the finding this check exists to close.
  if (!hasScope(caller, REQUIRED_SCOPE)) return undefined

  // AWAITED, not fire-and-forget. On Workers the isolate can be torn down the moment the
  // response is returned, so an untracked promise may never run and `lastUsedAt` then reads
  // "never used" for a token in daily use. Its only job is telling an organizer which
  // credential is safe to revoke, and a stamp that lands sometimes cannot do that job. The
  // rejection is still swallowed: an audit write may slow a request, never fail one.
  await touchApiToken(token.id, now()).catch(() => undefined)

  return caller
}

/** Whether the caller holds a scope. v1 issues only `read`, so this has one real answer. */
export function hasScope(caller: ApiCaller, scope: ApiScope): boolean {
  return caller.scopes.includes(scope)
}

/** The role this token's owner holds on one event, or `undefined` for no membership. */
export function callerRoleOn(caller: ApiCaller, eventId: string): EventRole | undefined {
  return caller.events.find((event) => event.id === eventId)?.role
}

/**
 * Whether the caller holds `required` (or better) on one event.
 *
 * `roleSatisfies` rather than `role === 'admin'`, so this stays a floor rather than an equality
 * test and keeps agreeing with `requireEventRole` about what `admin` covers. A string compare
 * here would be a second, quietly diverging definition of the role ladder.
 */
export function callerSatisfies(caller: ApiCaller, eventId: string, required: EventRole): boolean {
  const held = callerRoleOn(caller, eventId)
  return held !== undefined && roleSatisfies(held, required)
}

/**
 * Whether an API token row belongs to the acting user.
 *
 * Lives here rather than in `actions.ts` because that file is `'use server'` and may only
 * export async functions, and a synchronous predicate is what makes this testable. An absent
 * token answers `false` for the same reason the 401 body never varies: the revoke path must
 * refuse "somebody else's token" and "no such token" identically, or it becomes a way to learn
 * which token ids exist.
 */
export function ownsToken(token: ApiToken | undefined, userId: string): boolean {
  return token !== undefined && token.ownerId === userId
}
