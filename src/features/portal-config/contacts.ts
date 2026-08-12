// The contacts a portal filter is evaluated against. BUILD_SPEC 5.0c.
//
// Pure, and it takes no ids to look up: everything here is a projection of three lists an
// admin page already has in hand (`listSpeakers`, `listSubmissions`,
// `listSubmissionParticipants`). That is what keeps `matchPortal` free of reads and what
// makes the create wizard's review step cheap, since previewing a filter over 400
// contacts becomes array work rather than 400 lookups.
//
// The shape it produces is `PortalContact`, which is flattened into exactly what a filter
// can test and nothing else. Passing `Speaker` records around instead would mean the
// matcher had to know how to walk from a person to their sessions, and that walk needs
// the participants table, which is a read.
//
// Every list is filtered on `eventId` even though the DAL already filters, for the reason
// `features/resources/pages.ts` states: both sides of the join carry an event and only
// one of them is filtered by the read. A submission from another conference must not be
// able to hand this event's contact a track that qualifies them for a portal here.
// `Speaker` itself carries no `eventId` (a speaker belongs to many events, which is why
// `listSpeakers` scopes through the link rather than through `listByEvent`), so the
// caller's scoping is the only scoping available on that one list, and it is stated here
// rather than assumed silently.

import type { RecordId, Speaker, Submission, SubmissionParticipant } from '@/types/domain'
import type { PortalContact, PortalContactSession, PortalContactType } from '@/types/portals'
import { PORTAL_CONTACT_TYPES } from '@/types/portals'

/**
 * One `PortalContact` per speaker on the event, in the order the speakers arrived.
 *
 * Input order is preserved rather than re-sorted because `listSpeakers` already sorts on
 * last name and the review step lists people under that heading; sorting again here would
 * silently override the caller's choice from a module that cannot see the screen.
 *
 * A speaker with no submissions still produces a contact, with no roles and an empty
 * `sessions`. Dropping them would be wrong twice over: a manually added contact would
 * vanish from every matched count, and the default portal is by definition the bucket for
 * people no filter claims, so a contact with nothing to filter on is its most typical
 * member rather than an edge case.
 *
 * Which submissions count is the caller's decision, deliberately. This module never
 * inspects `status`, because "everyone who has ever submitted" and "confirmed speakers
 * only" are both real portal audiences and only the caller knows which list it passed. A
 * status rule baked in here would be invisible from the filter editor, which is the exact
 * class of failure §5.0c asks this module to make visible.
 */
export function buildPortalContacts(
  eventId: RecordId,
  speakers: readonly Speaker[],
  submissions: readonly Submission[],
  participants: readonly SubmissionParticipant[],
): readonly PortalContact[] {
  const sessions = sessionIndex(eventId, submissions)
  const roles = new Map<RecordId, Set<PortalContactType>>()
  const attended = new Map<RecordId, Map<RecordId, PortalContactSession>>()

  // The submitter pass comes first only so the reading order matches the comment above
  // it; the two passes are independent and both are idempotent per (speaker, submission).
  for (const submission of submissions) {
    const session = sessions.get(submission.id)
    if (session === undefined) continue
    // `submitter` is NOT a participant role, and that asymmetry is the whole reason it is
    // in PORTAL_CONTACT_TYPES: the account that owns the draft answers a different
    // question from who is presenting, and a submitter with no participant row of their
    // own would otherwise be a contact this event has no record of. That case is not
    // hypothetical: a programme manager who files sessions on behalf of speakers holds
    // exactly this role and no other.
    add(roles, submission.submitterId, 'submitter')
    remember(attended, submission.submitterId, session)
  }

  for (const participant of participants) {
    const session = sessions.get(participant.submissionId)
    // Drops a participant row pointing at another event's submission, and a row pointing
    // at a submission the caller did not pass. Both are the same check and it is the one
    // the DAL cannot make for us.
    if (session === undefined) continue
    add(roles, participant.speakerId, participant.role)
    remember(attended, participant.speakerId, session)
  }

  return speakers.map((speaker) => ({
    speakerId: speaker.id,
    company: speaker.company,
    roles: orderRoles(roles.get(speaker.id)),
    sessions: orderSessions(attended.get(speaker.id)),
  }))
}

/**
 * The session-side facts, per submission on this event.
 *
 * A `Map` rather than a filtered array because both passes above look a submission up by
 * id, and it doubles as the event filter: a lookup that misses is a row from somewhere
 * else, so the two callers get the scoping check for free instead of each writing it.
 */
function sessionIndex(
  eventId: RecordId,
  submissions: readonly Submission[],
): ReadonlyMap<RecordId, PortalContactSession> {
  const index = new Map<RecordId, PortalContactSession>()
  for (const submission of submissions) {
    if (submission.eventId !== eventId) continue
    index.set(submission.id, {
      submissionId: submission.id,
      format: submission.format,
      level: submission.level,
      language: submission.language,
      trackId: submission.trackId,
      tagIds: submission.tagIds,
    })
  }
  return index
}

function add(
  roles: Map<RecordId, Set<PortalContactType>>,
  speakerId: RecordId,
  role: PortalContactType,
): void {
  const existing = roles.get(speakerId)
  if (existing === undefined) {
    roles.set(speakerId, new Set([role]))
  } else {
    existing.add(role)
  }
}

/**
 * A speaker is remembered once per submission, keyed by submission id.
 *
 * The same person can reach one session twice, as its submitter and as a participant on
 * it, and a duplicated session would double every count the review step shows without
 * changing a single match, since every session test is an ANY.
 */
function remember(
  attended: Map<RecordId, Map<RecordId, PortalContactSession>>,
  speakerId: RecordId,
  session: PortalContactSession,
): void {
  const existing = attended.get(speakerId)
  if (existing === undefined) {
    attended.set(speakerId, new Map([[session.submissionId, session]]))
  } else {
    existing.set(session.submissionId, session)
  }
}

/**
 * Deduped by the `Set` and ordered by `PORTAL_CONTACT_TYPES`, never by arrival.
 *
 * Arrival order is Airtable's pagination order, so a role list built from it reshuffles
 * between two reads of the same data. That would not change a match (every role test is
 * an ANY) but it does change what the review step prints beside a person's name, and a
 * column that moves on its own is a column an organizer stops trusting.
 */
function orderRoles(
  roles: ReadonlySet<PortalContactType> | undefined,
): readonly PortalContactType[] {
  if (roles === undefined) return []
  return PORTAL_CONTACT_TYPES.filter((role) => roles.has(role))
}

/** Ordered on submission id for the same reason: total, cheap, and stable across reads. */
function orderSessions(
  sessions: ReadonlyMap<RecordId, PortalContactSession> | undefined,
): readonly PortalContactSession[] {
  if (sessions === undefined) return []
  return [...sessions.values()].sort((left, right) =>
    left.submissionId < right.submissionId ? -1 : left.submissionId > right.submissionId ? 1 : 0,
  )
}
