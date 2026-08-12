// Writes for the review graph: scores, and bulk reviewer assignment.
//
// Split from mutations.ts for the line limit. Same rule: every write ends in
// invalidate.ts.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import {
  findReview,
  listAssignmentsForRound,
  listSubmissionRoundsForRound,
} from '@/services/airtable/reads-review'
import { TABLES } from '@/services/airtable/tables'
import { eventReviewTag, submissionTag } from '@/services/airtable/tags'
import {
  type SubmissionRoundDraft,
  submissionRoundFields,
} from '@/services/airtable/to-fields-portal'
import {
  type AssignmentDraft,
  assignmentFields,
  type ReviewDraft,
  reviewFields,
} from '@/services/airtable/to-fields-review'
import type { RecordId } from '@/types/domain'

export type ReviewSave = ReviewDraft & { eventId: RecordId }

/**
 * Save one reviewer's scores for one (submission, round).
 *
 * Read-then-write rather than an upsert, and that needs justifying because 3.1
 * says to use upsert where a natural key exists. The natural key here is
 * (submission, round, reviewer), all three of which are LINK fields, and Airtable's
 * `performUpsert` merges on field VALUES: a linked record's value is its primary
 * field's text, so merging on it would match the wrong row as soon as two
 * submissions share a title. `client.upsertRecords` therefore exists for the keys
 * that really are text columns (`EmailOutbox.idempotencyKey`), and the review path
 * reads first instead. The exposure that leaves is two saves for the same reviewer
 * arriving within one round trip, which the autosave debounce in 3.1 (one write per
 * field per ~800ms, from a single browser tab) is what prevents. The clean fix is a
 * deterministic text key column on Reviews, which belongs in the migration.
 */
export async function saveReview(save: ReviewSave, origin: WriteOrigin = 'action'): Promise<void> {
  const client = getClient()
  const existing = await findReview({
    submissionId: save.submissionId,
    roundId: save.roundId,
    reviewerId: save.reviewerId,
  })
  const fields = reviewFields(save)

  if (existing === undefined) {
    await client.createRecords(TABLES.reviews, [fields])
  } else {
    await client.updateRecords(TABLES.reviews, [{ id: existing.id, fields }])
  }

  invalidate(origin, {
    own: [eventReviewTag(save.eventId), submissionTag(save.submissionId)],
  })
}

export type RoundEntry = {
  eventId: RecordId
  roundId: RecordId
  submissionIds: readonly RecordId[]
  /**
   * One instant for the whole batch, so a cohort advanced together reads as one event
   * in the log rather than forty timestamps a few milliseconds apart.
   */
  enteredAt: string
  /** `pending` unless a caller is recording an advance that already happened. */
  status?: SubmissionRoundDraft['status']
}

export type RoundEntryResult = { created: number; skipped: number }

/**
 * Put submissions into a round.
 *
 * Section 5.1b: an `entityKind=abstracts` submit gets a `SubmissionRounds` row AND
 * `ReviewAssignments` rows for the active plan's first round. `assignReviewers` covered
 * the second half; without this one an abstract was assigned to reviewers while having no
 * per-round state, so "advance to round 2" had nothing to advance and the Evaluation
 * surface's per-round progress counted zero of everything.
 *
 * Batched rather than one call per submission, because the bulk advance is the normal
 * path and forty single writes is forty round trips through a rate-limited API. The
 * client chunks the creates at 10.
 *
 * Idempotent on (submission, round), which is the unique constraint in section 3, and
 * enforced by reading first for the same reason `saveReview` does: both keys are LINK
 * fields, and `performUpsert` merges on a linked record's primary field TEXT, so it would
 * match the wrong row as soon as two submissions shared a title. The read is uncached,
 * because deciding between create and skip from a cached list is how one submission ends
 * up in a round twice.
 */
export async function enterSubmissionsIntoRound(
  entry: RoundEntry,
  origin: WriteOrigin = 'action',
): Promise<RoundEntryResult> {
  if (entry.submissionIds.length === 0) return { created: 0, skipped: 0 }

  const existing = await listSubmissionRoundsForRound(entry.roundId)
  const taken = new Set(existing.map((row) => row.submissionId))
  const fresh = entry.submissionIds.filter((submissionId) => !taken.has(submissionId))

  if (fresh.length === 0) return { created: 0, skipped: entry.submissionIds.length }

  await getClient().createRecords(
    TABLES.submissionRounds,
    fresh.map((submissionId) =>
      submissionRoundFields({
        submissionId,
        roundId: entry.roundId,
        status: entry.status,
        enteredAt: entry.enteredAt,
      }),
    ),
  )

  invalidate(origin, {
    // Per submission as well as per event: the abstracts table's per-round columns and
    // the submission detail both read this row, and only the event tag would leave a
    // detail page showing a submission that is not in any round.
    own: [eventReviewTag(entry.eventId), ...fresh.map(submissionTag)],
  })
  return { created: fresh.length, skipped: entry.submissionIds.length - fresh.length }
}

export type BulkAssignment = {
  eventId: RecordId
  roundId: RecordId
  submissionIds: readonly RecordId[]
  reviewerIds: readonly RecordId[]
  /** Set when the rows came from assigning a team. Section 3. */
  viaTeamId?: RecordId
  source: AssignmentDraft['source']
  assignedAt: string
}

/**
 * Materialise one assignment row per (submission, reviewer) for a round.
 *
 * Section 3 is explicit that a team assignment expands into individual rows rather
 * than a team-level record the reviewer queue joins through, so "assigned to me"
 * stays one lookup. Re-running is a no-op: existing tuples are read first and
 * skipped, which is the same idempotency the unique constraint describes, enforced
 * where it can actually be enforced (see saveReview for why not upsert).
 */
export async function assignReviewers(
  bulk: BulkAssignment,
  origin: WriteOrigin = 'action',
): Promise<{ created: number; skipped: number }> {
  if (bulk.submissionIds.length === 0 || bulk.reviewerIds.length === 0) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'assignment needs submissions and reviewers', {
      submissions: bulk.submissionIds.length,
      reviewers: bulk.reviewerIds.length,
    })
  }

  const existing = await listAssignmentsForRound(bulk.roundId)
  const taken = new Set(existing.map((row) => `${row.submissionId}:${row.reviewerId}`))

  const drafts: AssignmentDraft[] = []
  for (const submissionId of bulk.submissionIds) {
    for (const reviewerId of bulk.reviewerIds) {
      if (taken.has(`${submissionId}:${reviewerId}`)) continue
      drafts.push({
        submissionId,
        reviewerId,
        roundId: bulk.roundId,
        viaTeamId: bulk.viaTeamId,
        assignedAt: bulk.assignedAt,
        source: bulk.source,
      })
    }
  }

  const total = bulk.submissionIds.length * bulk.reviewerIds.length
  if (drafts.length === 0) return { created: 0, skipped: total }

  // Chunked at 10 by the client, so a committee of six across forty abstracts is
  // 24 requests through the scheduler rather than 240 individual writes.
  await getClient().createRecords(TABLES.reviewAssignments, drafts.map(assignmentFields))

  invalidate(origin, { own: [eventReviewTag(bulk.eventId)] })
  return { created: drafts.length, skipped: total - drafts.length }
}

export type PairAssignment = {
  eventId: RecordId
  roundId: RecordId
  /** Explicit (submission, reviewer) tuples. Not a cross product. */
  pairs: readonly { submissionId: RecordId; reviewerId: RecordId }[]
  source: AssignmentDraft['source']
  assignedAt: string
}

/**
 * Materialise an explicit list of (submission, reviewer) rows.
 *
 * `assignReviewers` above writes a CROSS PRODUCT, which is what a committee assignment
 * is: everyone picked reviews everything picked. Auto-distribution is the other shape.
 * Its whole purpose is that reviewer A takes these six and reviewer B takes those six,
 * so folding it into the cross-product call would mean one call per submission, which is
 * forty round trips through a rate-limited API to write forty rows.
 *
 * Idempotent on (submission, reviewer) exactly as its sibling is, and for the same
 * reason: `performUpsert` merges on a linked record's primary field TEXT, so it matches
 * the wrong row the moment two submissions share a title.
 */
export async function assignReviewerPairs(
  bulk: PairAssignment,
  origin: WriteOrigin = 'action',
): Promise<{ created: number; skipped: number }> {
  if (bulk.pairs.length === 0) return { created: 0, skipped: 0 }

  const existing = await listAssignmentsForRound(bulk.roundId)
  const taken = new Set(existing.map((row) => `${row.submissionId}:${row.reviewerId}`))

  const drafts: AssignmentDraft[] = []
  for (const pair of bulk.pairs) {
    const key = `${pair.submissionId}:${pair.reviewerId}`
    if (taken.has(key)) continue
    // Added as we go, so a caller that passed the same tuple twice writes it once.
    taken.add(key)
    drafts.push({
      submissionId: pair.submissionId,
      reviewerId: pair.reviewerId,
      roundId: bulk.roundId,
      assignedAt: bulk.assignedAt,
      source: bulk.source,
    })
  }

  if (drafts.length === 0) return { created: 0, skipped: bulk.pairs.length }

  await getClient().createRecords(TABLES.reviewAssignments, drafts.map(assignmentFields))

  invalidate(origin, { own: [eventReviewTag(bulk.eventId)] })
  return { created: drafts.length, skipped: bulk.pairs.length - drafts.length }
}
