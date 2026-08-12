// Live reads for the event-scoped lookups, the speaker list, and the review graph.
//
// Split from reads.ts to keep both under the line limit; the same "filter in code,
// not in a formula" reasoning applies and is explained there, as does the reason each
// read declares its own tags and window rather than a `'use cache'` wrapper doing it.
//
// The lookups get the long window and the review graph the short one, which is the split
// the removed `cacheLife('hours')` and `cacheLife('minutes')` calls encoded: tracks, tags
// and rooms change a handful of times per event, while a reviewer looks at a score
// seconds after saving it.
//
// The three reads at the bottom (`listAssignmentsForRound`, `listSubmissionRoundsForRound`,
// `findReview`) pass NO cache, because a mutation reads them to decide between create and
// skip. That is not a detail: a cached answer there duplicates a review row.

import { getClient } from '@/services/airtable/client'
import { mapSpeaker, speakerEventIds } from '@/services/airtable/mapping'
import {
  mapPlan,
  mapReview,
  mapReviewAssignment,
  mapRoom,
  mapRound,
  mapSubmissionRound,
  mapTag,
  mapTrack,
} from '@/services/airtable/mapping-lookups'
import { REVALIDATE, type ReadCache } from '@/services/airtable/read-cache'
import { byOrder, listByEvent } from '@/services/airtable/reads'
import { COL, TABLES } from '@/services/airtable/tables'
import {
  eventLookupsTag,
  eventPlanTag,
  eventReviewTag,
  eventSpeakersTag,
  speakerTag,
} from '@/services/airtable/tags'
import type {
  EvaluationPlan,
  Review,
  ReviewAssignment,
  Room,
  Round,
  Speaker,
  SubmissionRound,
  Tag,
  Track,
} from '@/types/domain'

/** Tracks, tags and rooms share one tag: they are the pickers on the same screens. */
function lookupsCache(eventId: string): ReadCache {
  return { tags: [eventLookupsTag(eventId)], revalidate: REVALIDATE.lookup }
}

export async function listTracks(eventId: string): Promise<readonly Track[]> {
  return await listByEvent(TABLES.tracks, eventId, mapTrack, {
    sort: byOrder,
    cache: lookupsCache(eventId),
  })
}

export async function listTags(eventId: string): Promise<readonly Tag[]> {
  return await listByEvent(TABLES.tags, eventId, mapTag, {
    sort: [{ field: COL.name, direction: 'asc' }],
    cache: lookupsCache(eventId),
  })
}

export async function listRooms(eventId: string): Promise<readonly Room[]> {
  return await listByEvent(TABLES.rooms, eventId, mapRoom, {
    sort: byOrder,
    cache: lookupsCache(eventId),
  })
}

/**
 * Speakers on one event. Scoped through the `events` link on the Speakers row,
 * which is why this cannot go through `listByEvent`: a speaker belongs to many
 * events, so there is no single `eventId` to compare.
 */
export async function listSpeakers(eventId: string): Promise<readonly Speaker[]> {
  const records = await getClient().listAll(TABLES.speakers, {
    tags: [eventSpeakersTag(eventId)],
    revalidate: REVALIDATE.edited,
  })
  return records
    .filter((record) => speakerEventIds(record).includes(eventId))
    .map(mapSpeaker)
    .sort((left, right) => left.lastName.localeCompare(right.lastName))
}

/** The plan and its rounds change once a cycle and are read constantly. */
function planCache(eventId: string): ReadCache {
  return { tags: [eventPlanTag(eventId)], revalidate: REVALIDATE.lookup }
}

/**
 * Every plan on the event, not just the active one.
 *
 * The editor needs this and the Evaluation surface does not: a draft plan being built
 * for next year is invisible to reviewers and has to be visible to the organizer
 * editing it, which is the whole reason `status` exists on the row.
 */
export async function listEvaluationPlans(eventId: string): Promise<readonly EvaluationPlan[]> {
  return await listByEvent(TABLES.evaluationPlans, eventId, mapPlan, { cache: planCache(eventId) })
}

/** Every round on the event, across all of its plans, in display order. */
export async function listRounds(eventId: string): Promise<readonly Round[]> {
  return await listByEvent(TABLES.rounds, eventId, mapRound, {
    sort: byOrder,
    cache: planCache(eventId),
  })
}

export async function getActivePlan(eventId: string): Promise<EvaluationPlan | undefined> {
  const plans = await listEvaluationPlans(eventId)
  // One active plan per event ships, and the selector is a later addition
  // (section 3). Falling back to the first plan keeps a draft-only event usable
  // instead of showing an empty Evaluation surface with no explanation.
  return plans.find((plan) => plan.status === 'active') ?? plans.at(0)
}

export async function listRoundsForActivePlan(eventId: string): Promise<readonly Round[]> {
  const plan = await getActivePlan(eventId)
  if (plan === undefined) return []
  const rounds = await listRounds(eventId)
  return rounds.filter((round) => round.planId === plan.id)
}

/**
 * A reviewer's queue for one event.
 *
 * Scoped through Rounds because ReviewAssignments has no event link of its own:
 * a round belongs to an event, an assignment belongs to a round. Two list calls
 * rather than the two-hop per-row lookup that section 3 warns about, and the
 * result is what the "assigned to me" filter reads.
 */
export async function listAssignmentsForReviewer(
  eventId: string,
  reviewerId: string,
): Promise<readonly ReviewAssignment[]> {
  // Both halves carry the review tag, including the rounds list: an assignment saved
  // against a round the reader has not seen yet is invisible until the scoping list
  // refreshes too.
  const cache: ReadCache = { tags: [eventReviewTag(eventId)], revalidate: REVALIDATE.edited }
  const [rounds, records] = await Promise.all([
    listByEvent(TABLES.rounds, eventId, mapRound, { sort: byOrder, cache }),
    getClient().listAll(TABLES.reviewAssignments, cache),
  ])
  const roundIds = new Set(rounds.map((round) => round.id))

  return records
    .map(mapReviewAssignment)
    .filter(
      (assignment) => assignment.reviewerId === reviewerId && roundIds.has(assignment.roundId),
    )
}

/** Every assignment already in a round. Used to make a bulk assign idempotent. */
export async function listAssignmentsForRound(
  roundId: string,
): Promise<readonly ReviewAssignment[]> {
  const records = await getClient().listAll(TABLES.reviewAssignments)
  return records.map(mapReviewAssignment).filter((row) => row.roundId === roundId)
}

/**
 * Every submission already in a round. Used to make entering a round idempotent, and
 * filtered in code because both keys are links.
 */
export async function listSubmissionRoundsForRound(
  roundId: string,
): Promise<readonly SubmissionRound[]> {
  const records = await getClient().listAll(TABLES.submissionRounds)
  return records.map(mapSubmissionRound).filter((row) => row.roundId === roundId)
}

/**
 * The one review a reviewer owns for a (submission, round). Uncached, because the
 * autosave path decides between create and update from it, and a cached answer
 * there would create a duplicate row a few hundred milliseconds after the first.
 */
export async function findReview(key: {
  submissionId: string
  roundId: string
  reviewerId: string
}): Promise<Review | undefined> {
  const records = await getClient().listAll(TABLES.reviews)
  return records
    .map(mapReview)
    .find(
      (review) =>
        review.submissionId === key.submissionId &&
        review.roundId === key.roundId &&
        review.reviewerId === key.reviewerId,
    )
}

/** One speaker. A direct record fetch, so no formula and no client-side filter. */
export async function getSpeaker(speakerId: string): Promise<Speaker> {
  return mapSpeaker(
    await getClient().getRecord(TABLES.speakers, speakerId, {
      tags: [speakerTag(speakerId)],
      revalidate: REVALIDATE.edited,
    }),
  )
}
