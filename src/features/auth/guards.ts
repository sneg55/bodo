// The authorization helpers every entry point calls for itself.
//
// BUILD_SPEC section 4 is built around one rule: a layout is not a security
// boundary. A Next app has several entry points, a layout does not re-run on every
// navigation, and returning null from one secures the rendered nav and nothing else.
// So each Server Action, each Route Handler, and each data-access function that
// touches owned data calls a guard here. Layout guards stay, but they are the
// redirect to the login page, not the enforcement.
//
// Two design constraints follow from that:
//
//   1. Nothing here assumes a React context. `subject` can be passed in, so a
//      Server Action that already authorized can hand the acting identity down to a
//      DAL function and the ownership check happens next to the data instead of
//      three layers above it.
//   2. Capability is never read off the session token. `requireEventRole` resolves
//      it from EventMemberships on every call, which is what makes revoking access
//      take effect on the next request instead of when a 30 day JWT expires.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { EventRole } from '@/constants/status'
import { currentSubject } from '@/features/auth/session'
import { type SessionSubject, subjectId } from '@/features/auth/tokens'
import type { EventMembership, RecordId } from '@/types/domain'

/**
 * How a guard gets at EventMemberships.
 *
 * Injected rather than imported, and it stays injected after the DAL lands. Two
 * reasons: guards are then testable without a network or a binding, and
 * `src/features/auth` does not import `src/services/airtable`, which keeps the
 * import graph one-directional. The DAL supplies a cached, tagged reader; see the
 * type note on `MembershipLoader` for the contract it has to satisfy.
 */
export type MembershipLoader = (userId: RecordId) => Promise<readonly EventMembership[]>

export type IdentityOptions = {
  /** The entry point's single instant. Nothing in this feature reads the clock. */
  nowMs: number
  /** Already-resolved identity, for a DAL call underneath an authorized action. */
  subject?: SessionSubject
  /** Test seam. Production leaves it unset and `tokens.authSecret()` applies. */
  secret?: Uint8Array
  /**
   * Where the identity comes from when `subject` was not passed. Defaults to the
   * session cookie. Overridable so a guard can be exercised, or driven from a
   * context that is not a Next request, without a live cookie store.
   */
  readSubject?: (options: {
    nowMs: number
    secret?: Uint8Array
  }) => Promise<SessionSubject | undefined>
}

export type SpeakerIdentity = {
  speakerId: RecordId
  /**
   * Present only when an organizer is acting as this speaker. It is a way back and never
   * a capability: `requireAdminUser` still refuses this session, and nothing reads it to
   * decide access. See src/features/auth/impersonation.ts.
   */
  impersonatorUserId?: RecordId
}
export type AdminIdentity = { userId: RecordId }

export async function requireSession(options: IdentityOptions): Promise<SessionSubject> {
  const read = options.readSubject ?? currentSubject
  const subject = options.subject ?? (await read(options))
  if (subject === undefined) {
    throw new AppError(ErrorIds.AUTH_NO_SESSION, 'no session cookie on this request')
  }
  return subject
}

/** The portal. A subject that is an admin user is not a speaker and is refused. */
export async function requireSpeaker(options: IdentityOptions): Promise<SpeakerIdentity> {
  const subject = await requireSession(options)
  if (subject.kind !== 'speaker') {
    throw wrongKind(subject, 'speaker')
  }
  return subject.impersonatorUserId === undefined
    ? { speakerId: subject.speakerId }
    : { speakerId: subject.speakerId, impersonatorUserId: subject.impersonatorUserId }
}

/**
 * The admin app. Holding an admin session is not by itself a role on an event.
 *
 * An impersonated session is refused here like any other speaker session, and that is the
 * property that keeps impersonation from being self-elevation: `kind` is what is checked,
 * and while an organizer is acting as a speaker their `kind` is `speaker`. The claim they
 * carry is not consulted, so no admin surface, action or event role opens up on it.
 */
export async function requireAdminUser(options: IdentityOptions): Promise<AdminIdentity> {
  const subject = await requireSession(options)
  if (subject.kind !== 'user') {
    throw wrongKind(subject, 'user')
  }
  return { userId: subject.userId }
}

export type EventScopeOptions = IdentityOptions & {
  eventId: RecordId
  loadMemberships: MembershipLoader
}

export type EventRoleOptions = EventScopeOptions & { role: EventRole }

/**
 * Assert the acting admin user holds `role` (or better) on `eventId`, and return
 * the role actually held, which is what a surface needs in order to decide whether
 * to render admin-only controls.
 */
export async function requireEventRole(
  options: EventRoleOptions,
): Promise<AdminIdentity & { role: EventRole }> {
  const { userId, held } = await resolveEventRole(options)

  if (held === undefined || !roleSatisfies(held, options.role)) {
    throw new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, `role ${options.role} is required`, {
      userId,
      eventId: options.eventId,
      held,
    })
  }
  return { userId, role: held }
}

/**
 * What role the caller holds on the event, or undefined for no membership. For
 * deciding what a nav or a page renders, where absence of a role is an ordinary
 * answer rather than a failure. It still raises for a missing session or a speaker
 * subject, because neither of those is an admin surface at all.
 */
export async function eventRoleOf(options: EventScopeOptions): Promise<EventRole | undefined> {
  return (await resolveEventRole(options)).held
}

async function resolveEventRole(
  options: EventScopeOptions,
): Promise<AdminIdentity & { held?: EventRole }> {
  const identity = await requireAdminUser(options)
  const memberships = await options.loadMemberships(identity.userId)
  return {
    userId: identity.userId,
    held: memberships.find((membership) => membership.eventId === options.eventId)?.role,
  }
}

/**
 * `admin` covers everything `reviewer` covers, so a required role is a floor rather
 * than an equality test. Ranked through a Map because indexing a plain object with a
 * variable is what `security/detect-object-injection` exists to stop.
 */
const ROLE_RANK = new Map<EventRole, number>([
  ['reviewer', 1],
  ['admin', 2],
])

export function roleSatisfies(held: EventRole, required: EventRole): boolean {
  return (ROLE_RANK.get(held) ?? 0) >= (ROLE_RANK.get(required) ?? 0)
}

/**
 * The ownership check for portal mutations. Synchronous and pure, so it can sit
 * inside a DAL write next to the record it is protecting rather than in the layout
 * three levels up.
 *
 * An admin subject is refused rather than allowed through: "View Portal"
 * impersonation (section 5.6) works by acting as a speaker session, so a `user`
 * subject reaching a portal mutation means the mutation was called from the wrong
 * surface, not that an admin should be trusted with someone else's record.
 */
export function requireSpeakerOwnership(options: {
  actor: SessionSubject
  ownerSpeakerId: RecordId
  /** What is being touched, for the log line: 'submission recABC', 'task recXYZ'. */
  resource: string
}): RecordId {
  const { actor, ownerSpeakerId, resource } = options
  if (actor.kind !== 'speaker' || actor.speakerId !== ownerSpeakerId) {
    throw new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, `${resource} does not belong to the caller`, {
      actor: subjectId(actor),
      actorKind: actor.kind,
      ownerSpeakerId,
      resource,
    })
  }
  return ownerSpeakerId
}

/**
 * Bind the membership loader once so call sites read
 * `requireEventRole({ eventId, role, nowMs })`. Wire this where the DAL is already
 * imported (a Server Action module, or a small `src/features/auth/wiring.ts` once
 * the DAL exports its reader) and pass the bound guards around.
 */
export function createEventRoleGuards(deps: { loadMemberships: MembershipLoader }): {
  requireEventRole: (
    options: Omit<EventRoleOptions, 'loadMemberships'>,
  ) => Promise<AdminIdentity & { role: EventRole }>
  eventRoleOf: (
    options: Omit<EventScopeOptions, 'loadMemberships'>,
  ) => Promise<EventRole | undefined>
} {
  return {
    requireEventRole: async (options) => await requireEventRole({ ...options, ...deps }),
    eventRoleOf: async (options) => await eventRoleOf({ ...options, ...deps }),
  }
}

function wrongKind(subject: SessionSubject, expected: SessionSubject['kind']): AppError {
  return new AppError(
    ErrorIds.AUTH_FORBIDDEN_ROLE,
    `this entry point requires a ${expected} session`,
    { held: subject.kind, expected, subject: subjectId(subject) },
  )
}
