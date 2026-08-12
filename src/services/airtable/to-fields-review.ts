// The write direction for the evaluation plan and its rounds.
//
// Its own file rather than more of `to-fields.ts`, which is at the size limit. The
// rules there apply here unchanged: a link goes out as an ARRAY of ids, `undefined`
// leaves a column alone, `null` clears it, and an empty string never reaches a select.

import type { ReviewRecommendation } from '@/constants/status'
import type { FieldSet } from '@/services/airtable/records'
import { COL } from '@/services/airtable/tables'
import { blank, compact, link } from '@/services/airtable/to-fields'
import type { Criterion, RecordId } from '@/types/domain'

export type PlanDraft = {
  eventId: RecordId
  name: string
  status: 'draft' | 'active' | 'closed'
  createdAt?: string
}

export function planFields(draft: PlanDraft): FieldSet {
  return compact({
    [COL.name]: draft.name,
    [COL.event]: link(draft.eventId),
    [COL.status]: draft.status,
    [COL.createdAt]: draft.createdAt,
  })
}

/**
 * Everything about a round except its identity.
 *
 * PARTIAL BY CONSTRUCTION: every field except the links is optional, so a caller that
 * only renames a round sends only the name and cannot blank its rubric. The two link
 * fields are the exception and are spelled out below.
 */
export type RoundDraft = {
  eventId: RecordId
  planId: RecordId
  name?: string
  order?: number
  criteria?: readonly Criterion[]
  startsAt?: string | null
  endsAt?: string | null
  anonymous?: boolean
  /**
   * The round's reviewer pool. `undefined` leaves it alone; `[]` CLEARS it, which
   * means "everyone on the event" rather than "nobody" (see `Round.reviewerIds`).
   * Both are legitimate here, which is why this is the one field that distinguishes
   * absent from empty.
   */
  reviewerIds?: readonly RecordId[]
  /**
   * The per-reviewer ceiling. `undefined` leaves it alone; `null` CLEARS it back to no
   * ceiling. The same absent-versus-empty distinction the pool above needs, and for the
   * same reason: removing a cap is an ordinary thing to do.
   */
  maxPerReviewer?: number | null
}

export function roundFields(draft: RoundDraft): FieldSet {
  return compact({
    [COL.name]: blank(draft.name),
    [COL.plan]: link(draft.planId),
    [COL.event]: link(draft.eventId),
    [COL.order]: draft.order,
    // Stringified here and not by the caller, so the only place that knows this column
    // is a JSON blob is the same place that knows its column name.
    [COL.criteriaJson]: draft.criteria === undefined ? undefined : JSON.stringify(draft.criteria),
    // A cleared date is `null` and not `''`: Airtable rejects the empty string on a
    // dateTime column, and an organizer removing a round's close date is ordinary.
    [COL.startsAt]: draft.startsAt,
    [COL.endsAt]: draft.endsAt,
    // Sent as a boolean, not through `blank()`: `false` is a real value here and
    // `blank` would pass it through untouched anyway, but naming it stops the next
    // reader wondering whether unchecking the box clears the column.
    [COL.anonymous]: draft.anonymous,
    [COL.reviewers]: draft.reviewerIds === undefined ? undefined : [...draft.reviewerIds],
    [COL.maxPerReviewer]: draft.maxPerReviewer,
  })
}

export type ReviewDraft = {
  submissionId: RecordId
  roundId: RecordId
  reviewerId: RecordId
  scores: Record<string, number>
  /** Answers to `text` criteria, keyed by criterion. */
  notes?: Readonly<Record<string, string>>
  recused?: boolean
  comment?: string
  /**
   * `null` CLEARS it, `undefined` leaves it alone.
   *
   * The distinction is load-bearing here and nowhere else in this file: a reviewer who
   * scored a submission and then declared a conflict of interest must stop voting on it,
   * and `undefined` would leave their old recommendation in the column forever because
   * `compact` drops the key entirely.
   */
  recommendation?: ReviewRecommendation | null
  updatedAt: string
}

export function reviewFields(draft: ReviewDraft): FieldSet {
  return compact({
    [COL.submission]: link(draft.submissionId),
    [COL.round]: link(draft.roundId),
    [COL.reviewer]: link(draft.reviewerId),
    [COL.scoresJson]: JSON.stringify(draft.scores),
    [COL.notesJson]: draft.notes === undefined ? undefined : JSON.stringify(draft.notes),
    [COL.recused]: draft.recused,
    [COL.comment]: draft.comment,
    [COL.recommendation]: draft.recommendation,
    [COL.updatedAt]: draft.updatedAt,
  })
}

export type AssignmentDraft = {
  submissionId: RecordId
  roundId: RecordId
  reviewerId: RecordId
  viaTeamId?: RecordId
  assignedAt: string
  source: 'routing' | 'manual' | 'team'
}

export function assignmentFields(draft: AssignmentDraft): FieldSet {
  return compact({
    [COL.submission]: link(draft.submissionId),
    [COL.round]: link(draft.roundId),
    [COL.reviewer]: link(draft.reviewerId),
    [COL.viaTeam]: draft.viaTeamId === undefined ? undefined : link(draft.viaTeamId),
    [COL.assignedAt]: draft.assignedAt,
    [COL.source]: draft.source,
  })
}
