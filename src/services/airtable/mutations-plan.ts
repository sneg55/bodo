// Writes for the evaluation plan and its rounds.
//
// These are the paths that did not exist: the base could be SEEDED with a plan and two
// rounds, and nothing in the app could create, rename, re-order or configure one, so
// every rubric an organizer got was the one the seed script happened to write.
//
// Both tables are configuration rather than transactional data, so all of it expires
// `event:{id}:plan` (what the Evaluation surface reads) and `event:{id}:review` (the
// queue, the progress bars and the Ratings column, all of which read a round's criteria
// to say anything at all). Expiring only the first left an admin looking at a renamed
// round whose scores were still weighted the old way.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import {
  listAssignmentsForRound,
  listSubmissionRoundsForRound,
} from '@/services/airtable/reads-review'
import { onlyRecord } from '@/services/airtable/records'
import { TABLES } from '@/services/airtable/tables'
import { eventPlanTag, eventReviewTag } from '@/services/airtable/tags'
import {
  type PlanDraft,
  planFields,
  type RoundDraft,
  roundFields,
} from '@/services/airtable/to-fields-review'
import type { RecordId } from '@/types/domain'

/** Both tags, together, for the reason in the file header. */
function planTags(eventId: RecordId): readonly string[] {
  return [eventPlanTag(eventId), eventReviewTag(eventId)]
}

export async function createEvaluationPlan(
  draft: PlanDraft,
  origin: WriteOrigin = 'action',
): Promise<RecordId> {
  const created = await getClient().createRecords(TABLES.evaluationPlans, [planFields(draft)])
  const record = onlyRecord(created, TABLES.evaluationPlans)
  invalidate(origin, { own: planTags(draft.eventId) })
  return record.id
}

export async function updateEvaluationPlan(
  update: { planId: RecordId } & PlanDraft,
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().updateRecords(TABLES.evaluationPlans, [
    { id: update.planId, fields: planFields(update) },
  ])
  invalidate(origin, { own: planTags(update.eventId) })
}

export async function createRound(
  draft: RoundDraft,
  origin: WriteOrigin = 'action',
): Promise<RecordId> {
  const created = await getClient().createRecords(TABLES.rounds, [roundFields(draft)])
  const record = onlyRecord(created, TABLES.rounds)
  invalidate(origin, { own: planTags(draft.eventId) })
  return record.id
}

export async function updateRound(
  update: { roundId: RecordId } & RoundDraft,
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().updateRecords(TABLES.rounds, [
    { id: update.roundId, fields: roundFields(update) },
  ])
  invalidate(origin, { own: planTags(update.eventId) })
}

/**
 * Delete a round, but only while nothing has happened in it.
 *
 * A round that has assignments or submissions in it is REFUSED rather than cascaded.
 * Airtable has no foreign keys and no cascade, so deleting the round would leave its
 * assignments and its reviews pointing at a record id that resolves to nothing: the
 * rows survive, every read that scopes through Rounds drops them, and the scores are
 * gone from the product while still sitting in the base. An organizer who genuinely
 * wants the round gone can empty it first, which is a decision they can see.
 *
 * The two reads are uncached for the reason `enterSubmissionsIntoRound` gives: deciding
 * whether a delete is safe from a list that may be a minute old is how it stops being
 * safe.
 */
export async function deleteRound(
  input: { eventId: RecordId; roundId: RecordId },
  origin: WriteOrigin = 'action',
): Promise<void> {
  const [assignments, entries] = await Promise.all([
    listAssignmentsForRound(input.roundId),
    listSubmissionRoundsForRound(input.roundId),
  ])
  if (assignments.length > 0 || entries.length > 0) {
    throw new AppError(
      ErrorIds.DATA_WRITE_FAIL,
      'that round has submissions or reviewers in it, so it cannot be deleted',
      { roundId: input.roundId, assignments: assignments.length, submissions: entries.length },
    )
  }

  await getClient().deleteRecords(TABLES.rounds, [input.roundId])
  invalidate(origin, { own: planTags(input.eventId) })
}
