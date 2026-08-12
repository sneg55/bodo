// Reads the Evaluation and Abstracts surfaces need and the DAL does not expose yet:
// the event's Reviews, its ReviewTeams, a team's members, and the people on the event
// who can review.
//
// WHY THIS IS HERE AND NOT IN src/services/airtable. It should be there, next to
// `reads-review.ts`, on the `DataSource` interface, with a fixture branch in
// `source.ts` like every other read. `src/services/airtable` is owned by another
// agent in this pass, and the Ratings column and the reviewer queue cannot be built
// without these four reads, so they live here with the DAL's own rules kept intact:
// the Airtable column names stay inside the mappers in `mapping-lookups.ts` rather
// than being re-spelled here. Folding these into the DAL is a move, not a rewrite.
//
// These were `'use cache'` functions with an explicit `cacheTag`/`cacheLife`. Cache
// Components is off (next.config.ts explains why the adapter forced that), so they are
// ordinary async functions and the cache moved down onto the request: each one hands
// `listAll` the same tags it used to name and the window its `cacheLife` profile
// resolved to, exactly as `reads-review.ts` does next door. The tag vocabulary is
// unchanged, so the writes in mutations-review.ts still expire these reads. A read here
// with no `ReadCache` argument would be `no-store`, which is how the caching would go
// missing silently.
//
// The one exception is ReviewTeamMembers, which has no mapper. Its two link columns
// are read through `records.ts` helpers using the shared `COL` registry, so no
// Airtable field name is spelled in this file either.

import { getClient } from '@/services/airtable/client'
import {
  FIXTURE_ADMINS,
  FIXTURE_ASSIGNMENTS,
  FIXTURE_MEMBERSHIPS,
  FIXTURE_REVIEWS,
  FIXTURE_ROUNDS,
  FIXTURE_TEAM,
} from '@/services/airtable/fixtures'
import {
  mapAdminUser,
  mapMembership,
  mapReview,
  mapReviewAssignment,
  mapReviewTeam,
} from '@/services/airtable/mapping-lookups'
import { REVALIDATE, type ReadCache } from '@/services/airtable/read-cache'
import { type AirtableRecord, optionalLink, view } from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import { eventReviewTag, eventTag } from '@/services/airtable/tags'
import type { AdminUser, RecordId, Review, ReviewAssignment, ReviewTeam } from '@/types/domain'
import { hasAirtable } from '@/utils/env'

/**
 * The review graph, tagged as one thing. The scoping Rounds list carries the review tag
 * too, for the reason `reads-review.ts` gives about its own pair: a review or an
 * assignment saved against a round the reader has not fetched yet stays invisible until
 * that list refreshes with it.
 */
function reviewCache(eventId: string, revalidate: number): ReadCache {
  return { tags: [eventReviewTag(eventId)], revalidate }
}

/** Ids of the rounds belonging to one event, from already-fetched Rounds records. */
function eventRoundIds(records: readonly AirtableRecord[], eventId: string): ReadonlySet<string> {
  return new Set(
    records
      .map((record) => view(TABLES.rounds, record))
      .filter((source) => optionalLink(source, COL.event) === eventId)
      .map((source) => source.id),
  )
}

/** The fixture equivalent, which has typed rows and therefore needs no mapping. */
function fixtureRoundIds(eventId: string): ReadonlySet<string> {
  return new Set(
    FIXTURE_ROUNDS.filter((round) => round.eventId === eventId).map((round) => round.id),
  )
}

/**
 * Reviews are scoped through Rounds, because a Review links to a round and a round
 * links to an event; there is no event link on Reviews itself. Same two-list shape as
 * `listAssignmentsForReviewer` in the DAL, and for the same reason: two list calls
 * beat the per-row lookup fan-out that BUILD_SPEC 3.1 warns about.
 */
export async function listReviewsForEvent(eventId: string): Promise<readonly Review[]> {
  if (!hasAirtable()) {
    const rounds = fixtureRoundIds(eventId)
    return FIXTURE_REVIEWS.filter((review) => rounds.has(review.roundId))
  }

  const client = getClient()
  const cache = reviewCache(eventId, REVALIDATE.edited)
  const [rounds, records] = await Promise.all([
    client.listAll(TABLES.rounds, cache),
    client.listAll(TABLES.reviews, cache),
  ])
  const roundIds = eventRoundIds(rounds, eventId)
  return records.map(mapReview).filter((review) => roundIds.has(review.roundId))
}

/**
 * Every assignment on the event, not just the acting reviewer's.
 *
 * The DAL exposes `listAssignmentsForReviewer`, which is the right shape for a queue and
 * the wrong shape for per-round progress: "18 of 40 reviewed" is a fact about the whole
 * committee. Same round-scoping trick, and deliberately one list rather than a call per
 * reviewer, which is the fan-out BUILD_SPEC 3.1 rules out.
 */
export async function listAssignmentsForEvent(
  eventId: string,
): Promise<readonly ReviewAssignment[]> {
  if (!hasAirtable()) {
    const rounds = fixtureRoundIds(eventId)
    return FIXTURE_ASSIGNMENTS.filter((assignment) => rounds.has(assignment.roundId))
  }

  const client = getClient()
  const cache = reviewCache(eventId, REVALIDATE.edited)
  const [rounds, records] = await Promise.all([
    client.listAll(TABLES.rounds, cache),
    client.listAll(TABLES.reviewAssignments, cache),
  ])
  const roundIds = eventRoundIds(rounds, eventId)
  return records.map(mapReviewAssignment).filter((row) => roundIds.has(row.roundId))
}

export async function listReviewTeams(eventId: string): Promise<readonly ReviewTeam[]> {
  if (!hasAirtable()) {
    return FIXTURE_TEAM.eventId === eventId ? [FIXTURE_TEAM] : []
  }
  // A committee is edited a handful of times per event, so the longer window, which is
  // what `cacheLife('hours')` resolved to before.
  const teams = await getClient().listAll(
    TABLES.reviewTeams,
    reviewCache(eventId, REVALIDATE.lookup),
  )
  return teams.map(mapReviewTeam).filter((team) => team.eventId === eventId)
}

/** A committee and who is on it, which is what the assignment panel needs to be honest. */
export type ReviewTeamWithMembers = ReviewTeam & { readonly memberIds: readonly RecordId[] }

/**
 * The committees with their membership resolved.
 *
 * The panel needs the membership BEFORE the press, not after it. Picking the default
 * committee on a round whose pool excludes every one of its members produced an assignment
 * that wrote nothing, and the only feedback was an error toast after the round trip; the
 * panel now says so under the select and disables the button. `assignCommitteeAction` still
 * makes the same check for itself, because a Server Action is reachable without this panel.
 *
 * ONE read of ReviewTeamMembers, grouped, rather than one per committee: a plan with four
 * committees would otherwise spend four of the base's five requests per second
 * (BUILD_SPEC 3.1) re-reading the same table to answer four different questions about it.
 */
export async function listReviewTeamsWithMembers(
  eventId: string,
): Promise<readonly ReviewTeamWithMembers[]> {
  const teams = await listReviewTeams(eventId)
  if (!hasAirtable()) {
    // The fixture branch has no ReviewTeamMembers rows to group, so it answers the way
    // `listTeamMemberIds` does, which is what keeps the no-credentials demo walkable.
    const memberIds = await listTeamMemberIds(eventId, '')
    return teams.map((team) => ({ ...team, memberIds }))
  }

  const byTeam = await teamMemberIdsByTeam(eventId)
  return teams.map((team) => ({ ...team, memberIds: byTeam.get(team.id) ?? [] }))
}

/** Every ReviewTeamMembers row for the event, grouped by committee. Live bases only. */
async function teamMemberIdsByTeam(
  eventId: string,
): Promise<ReadonlyMap<string, readonly RecordId[]>> {
  const records = await getClient().listAll(
    TABLES.reviewTeamMembers,
    reviewCache(eventId, REVALIDATE.lookup),
  )
  const grouped = new Map<string, RecordId[]>()
  for (const record of records) {
    const source = view(TABLES.reviewTeamMembers, record)
    const teamId = optionalLink(source, COL.team)
    const userId = optionalLink(source, COL.user)
    // A row missing either link points at a deleted committee or a deleted user, and
    // assigning to it would be assigning to nobody.
    if (teamId === undefined || userId === undefined) continue
    const found = grouped.get(teamId)
    if (found === undefined) grouped.set(teamId, [userId])
    else found.push(userId)
  }
  return grouped
}

export type EventReviewer = AdminUser & { readonly role: 'admin' | 'reviewer' }

/**
 * Everyone with a membership on the event, with the role they hold. Admins are
 * included because an admin satisfies `reviewer` (guards.ts `roleSatisfies`), so an
 * organizer can put themselves on a committee, which is what a small conference
 * actually does.
 */
export async function listEventReviewers(eventId: string): Promise<readonly EventReviewer[]> {
  const [memberships, users] = hasAirtable()
    ? await liveMemberships(eventId)
    : [FIXTURE_MEMBERSHIPS, FIXTURE_ADMINS]

  const userById = new Map(users.map((user) => [user.id, user]))
  return memberships
    .filter((membership) => membership.eventId === eventId)
    .flatMap((membership) => {
      const user = userById.get(membership.userId)
      // A membership pointing at a deleted AdminUser is dropped rather than rendered
      // as a blank checkbox that assigns work to nobody.
      return user === undefined ? [] : [{ ...user, role: membership.role }]
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Memberships and admin users, both under the event tag rather than the review tag:
 * granting somebody a role is an event change, and `event:{id}` is the tag that says so.
 */
async function liveMemberships(eventId: string) {
  const client = getClient()
  const cache: ReadCache = { tags: [eventTag(eventId)], revalidate: REVALIDATE.lookup }
  const [membershipRecords, userRecords] = await Promise.all([
    client.listAll(TABLES.eventMemberships, cache),
    client.listAll(TABLES.adminUsers, cache),
  ])
  return [membershipRecords.map(mapMembership), userRecords.map(mapAdminUser)] as const
}

/**
 * The members of one committee.
 *
 * ReviewTeamMembers has no mapper in the DAL and no fixture row, so the fixture
 * branch answers with the event's reviewers. That matches what `FIXTURE_ASSIGNMENTS`
 * already implies (fixTeam1 produced rows for fixUser2 and fixUser3) and it keeps the
 * no-credentials demo able to walk a committee assignment end to end.
 */
export async function listTeamMemberIds(
  eventId: string,
  teamId: string,
): Promise<readonly string[]> {
  if (!hasAirtable()) {
    const reviewers = await listEventReviewers(eventId)
    return reviewers.filter((person) => person.role === 'reviewer').map((person) => person.id)
  }

  const members = await getClient().listAll(
    TABLES.reviewTeamMembers,
    reviewCache(eventId, REVALIDATE.lookup),
  )
  return members.flatMap((record) => {
    const source = view(TABLES.reviewTeamMembers, record)
    if (optionalLink(source, COL.team) !== teamId) return []
    const userId = optionalLink(source, COL.user)
    return userId === undefined ? [] : [userId]
  })
}
