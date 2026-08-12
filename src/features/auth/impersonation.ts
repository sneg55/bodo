// Admin-to-portal impersonation: the two transitions, and nothing else.
//
// The design was already settled in guards.ts and is not reopened here: impersonation
// works by ACTING AS A SPEAKER SESSION. That is why `requireSpeakerOwnership` refuses an
// admin subject rather than trusting it, and it is why entering means replacing the
// organizer's session with a speaker session rather than adding a permission to theirs.
// The only thing this feature adds to the token is `impersonatorUserId`, a way back.
//
// Four rules hold both functions together, and each one is a case in
// tests/auth-impersonation.test.ts:
//
//   1. **Entering is an organizer power.** `requireEventRole(eventId, 'admin')` is what
//      authorizes it, so a reviewer is refused: holding a role on an event is not
//      permission to act as one of its speakers. A speaker subject is refused by the same
//      call, because it is not a `user` at all, and so is a session that is ALREADY
//      impersonating, since that session's kind is `speaker`. There is therefore no path
//      by which anybody hands themselves this power or nests it.
//   2. **The claim is not a capability.** It records who started the session, which is a
//      fact about the past. Leaving re-reads EventMemberships for that user and requires
//      `admin` again, so a claim whose admin was demoted or removed mid-session buys
//      nothing. Capability comes from EventMemberships per request, never from the cookie.
//   3. **The target must really be a speaker on the event**, checked against the event's
//      own Speakers rows and after authorization, so an unauthorized caller learns nothing
//      about who is on a roster.
//   4. **One portal, one event.** The portal reads its event from configuration
//      (`portalEventId`), so entering it "as" a speaker of some other event would show the
//      wrong event's submissions and tasks under that speaker's name. The mismatch is
//      refused at the entry rather than papered over, which also means the event to
//      re-authorize against on the way out is unambiguous and needs no second claim.
//
// Everything is injected. That keeps `src/features/auth` free of an import into
// `src/services/airtable` (guards.ts makes the same trade for the same reason) and it is
// what lets the tests exercise the real guard with a stub membership loader.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { EventRole } from '@/constants/status'
import type { AdminIdentity } from '@/features/auth/guards'
import type { SessionSubject } from '@/features/auth/tokens'
import type { RecordId } from '@/types/domain'

/** `requireEventRole`, bound to the DAL's membership loader by wiring.ts. */
export type RoleCheck = (input: {
  eventId: RecordId
  role: EventRole
  /** Omitted to authorize the session on the request; passed to re-check the claim. */
  subject?: SessionSubject
}) => Promise<AdminIdentity & { role: EventRole }>

/** `establishSession`, which mints the token and writes the cookie. */
export type SessionWriter = (input: { subject: SessionSubject; nowMs: number }) => Promise<void>

/** The event's own Speakers rows. Only the ids are read. */
export type EventSpeakerReader = (eventId: RecordId) => Promise<readonly { id: RecordId }[]>

export type BeginImpersonation = {
  /** The event the organizer is acting on, from the admin surface they clicked. */
  eventId: RecordId
  speakerId: RecordId
  /** What the portal is configured to serve, from `portalEventId()`. */
  portalEventId: RecordId
  nowMs: number
  /** Omit to let the role check read the session cookie itself. */
  subject?: SessionSubject
  requireEventRole: RoleCheck
  listEventSpeakers: EventSpeakerReader
  establish: SessionWriter
  /** A fresh unguessable grant id. Injected so a test can pin it. */
  newGrantId: () => string
}

/**
 * Replace the organizer's session with a speaker session that remembers who they were.
 *
 * Returns both ids so the caller can log the pair. That log line is the only durable
 * record that a write was made by an organizer rather than by the speaker, which is a
 * limitation stated plainly rather than hidden: no table here has an actor column.
 */
export async function beginImpersonation(
  input: BeginImpersonation,
): Promise<{ userId: RecordId; speakerId: RecordId }> {
  if (input.eventId !== input.portalEventId) {
    throw new AppError(
      ErrorIds.AUTH_IMPERSONATION_INVALID,
      'the portal serves a different event, so viewing it as this speaker would show the wrong event',
      { eventId: input.eventId, portalEventId: input.portalEventId },
    )
  }

  // Authorization first, and it covers every self-elevation route at once: no session,
  // a speaker session, an already-impersonating session, and a reviewer.
  const { userId } = await input.requireEventRole({
    eventId: input.eventId,
    role: 'admin',
    subject: input.subject,
  })

  const speakers = await input.listEventSpeakers(input.eventId)
  if (!speakers.some((speaker) => speaker.id === input.speakerId)) {
    throw new AppError(
      ErrorIds.DATA_RECORD_NOT_FOUND,
      'that speaker is not on this event, so there is no portal to view as them',
      { eventId: input.eventId, speakerId: input.speakerId, userId },
    )
  }

  await input.establish({
    subject: {
      kind: 'speaker',
      speakerId: input.speakerId,
      impersonatorUserId: userId,
      // Spent exactly once on the way back, so a copy of this cookie cannot also be
      // exchanged for the organizer's admin session. See the note in tokens.ts.
      impersonationGrantId: input.newGrantId(),
      // Carried across the transition. Without this, an organizer who signed in through
      // the demo door could shed the mark simply by viewing the portal, and the session
      // would then outlive DEMO_MODE being turned off.
      ...(input.subject?.viaDemo === true ? { viaDemo: true as const } : {}),
    },
    nowMs: input.nowMs,
  })

  return { userId, speakerId: input.speakerId }
}

export type EndImpersonation = {
  /** The event to re-authorize against, from `portalEventId()`. */
  eventId: RecordId
  /** The session on the request, already resolved by `requireSession`. */
  subject: SessionSubject
  nowMs: number
  requireEventRole: RoleCheck
  establish: SessionWriter
  /** `claimOnce`, so the grant can be spent exactly once. */
  claim: (key: string, holder: string, ttlMs: number) => Promise<{ granted: boolean }>
  /** A per-request holder, so a second attempt is a different claimant and is refused. */
  newGrantId: () => string
}

/** How long a spent grant is remembered. Longer than the session it belonged to. */
const GRANT_TTL_MS = 45 * 24 * 60 * 60 * 1000

/**
 * `Back to Admin Mode`: restore the admin session the claim names, if that user still holds
 * `admin` on the event AND this session's grant has not already been spent.
 *
 * Two checks and they answer different questions, which is the thing an earlier version of
 * this comment got wrong. Re-reading EventMemberships answers "does that user still hold
 * admin", so a demoted organizer is refused. It does NOT answer "is the bearer of this
 * cookie that user", and without a second check anyone holding a copy of the cookie could
 * exchange a speaker session for the organizer's admin one. Found by Codex review.
 *
 * The grant is what answers the second question. It is claimed through the ClaimGuard
 * Durable Object with a fresh holder per attempt, so the first exit wins and a replay is
 * refused. Claimed BEFORE the role read, so a refused replay cannot be told apart from a
 * refused role by how long it took, and so a replay cannot spend a membership read.
 *
 * What this does not do, stated rather than implied: it does not stop a stolen cookie being
 * used AS THE SPEAKER, which no bearer token can, and it does not end an impersonation
 * already in flight when the organizer's role is revoked. That second one is recorded as an
 * open gap in BUILD_SPEC-implementation-notes.md.
 */
export async function endImpersonation(input: EndImpersonation): Promise<{ userId: RecordId }> {
  const impersonatorUserId =
    input.subject.kind === 'speaker' ? input.subject.impersonatorUserId : undefined

  if (impersonatorUserId === undefined) {
    throw new AppError(
      ErrorIds.AUTH_IMPERSONATION_INVALID,
      'this session did not start as impersonation, so there is no admin session to go back to',
      { kind: input.subject.kind },
    )
  }

  const grantId = input.subject.kind === 'speaker' ? input.subject.impersonationGrantId : undefined
  if (grantId === undefined) {
    throw new AppError(
      ErrorIds.AUTH_IMPERSONATION_INVALID,
      'this session carries no way back, so there is no admin session to restore',
      { kind: input.subject.kind },
    )
  }

  const { granted } = await input.claim(
    `impersonation:${grantId}`,
    input.newGrantId(),
    GRANT_TTL_MS,
  )
  if (!granted) {
    throw new AppError(
      ErrorIds.AUTH_IMPERSONATION_INVALID,
      'that way back has already been used, so this session cannot be exchanged for an admin one',
      { grantId },
    )
  }

  const subject: SessionSubject = {
    kind: 'user',
    userId: impersonatorUserId,
    // Carried back out for the same reason it was carried in: the round trip must not be
    // a way to convert a demo session into an unmarked one.
    ...(input.subject.viaDemo === true ? { viaDemo: true as const } : {}),
  }
  // Re-authorized from EventMemberships, not from the claim. The claim proves who started
  // the session; it does not prove they still hold the role.
  const { userId } = await input.requireEventRole({
    eventId: input.eventId,
    role: 'admin',
    subject,
  })

  await input.establish({ subject, nowMs: input.nowMs })
  return { userId }
}
