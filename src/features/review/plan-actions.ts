'use server'

// The evaluation plan editor's writes: create and edit a plan, and create, edit and delete
// its rounds. Re-ordering is not among them; see the note where it used to be.
//
// Every one of them requires `admin` on the event in the URL, and every one of them
// resolves the record it is about against THAT event before touching it. A plan id and
// a round id are both client input, so without the second check an admin of one event
// could rewrite another event's rubric by posting its record id: the role check would
// pass, because they really are an admin, just not of that. Answered as not-found
// rather than forbidden, so the id cannot be probed.
//
// Criteria go through `normalizeCriterion` here, not only in the form. A Server Action
// is reachable by POST with no page ever rendering, and a rubric written with `max`
// below `min` is a criterion that silently stops counting on every review from then on.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { criterionProblems, normalizeCriterion } from '@/features/review/plan-editor'
import { listEventReviewers } from '@/features/review/review-reads'
import {
  createEvaluationPlan,
  createRound,
  deleteRound,
  updateEvaluationPlan,
  updateRound,
} from '@/services/airtable/mutations-plan'
import { listEvaluationPlans, listRounds } from '@/services/airtable/queries'
import type { Criterion, EvaluationPlan, RecordId, Round } from '@/types/domain'

const PLAN_STATUSES = ['draft', 'active', 'closed'] as const
type PlanStatus = (typeof PLAN_STATUSES)[number]

/**
 * The typed per-reviewer ceiling, or `null` to clear it.
 *
 * Blank clears, and so does anything that is not a number, because the alternative is
 * storing NaN in a column that auto-distribution reads as a limit. A negative is clamped
 * to zero rather than rejected: zero already means "nobody may take anything", which is
 * the nearest honest reading of a negative ceiling.
 */
function parseCap(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.trunc(parsed))
}

export type PlanInput = {
  eventId: RecordId
  planId?: RecordId
  name: string
  status: string
}

export type RoundInput = {
  eventId: RecordId
  planId: RecordId
  roundId?: RecordId
  name: string
  criteria: readonly Criterion[]
  /** Empty string clears the date. */
  startsAt: string
  endsAt: string
  anonymous: boolean
  reviewerIds: readonly RecordId[]
  /**
   * The per-reviewer ceiling for auto-distribution. Empty string clears it back to no
   * ceiling, the same way the dates above clear. A number input posts a string either
   * way, so parsing it is this action's job rather than the card's.
   */
  maxPerReviewer: string
}

export async function savePlanAction(
  input: PlanInput,
): Promise<ActionResult<{ planId: RecordId }>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const name = input.name.trim()
    if (name === '') {
      throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, 'the plan needs a name', {
        eventId: input.eventId,
      })
    }
    const status = assertStatus(input.status)

    if (input.planId === undefined) {
      const planId = await createEvaluationPlan({
        eventId: input.eventId,
        name,
        status,
        createdAt: new Date().toISOString(),
      })
      return actionOk({ planId })
    }

    const plan = await requirePlan(input.eventId, input.planId)
    await updateEvaluationPlan({ planId: plan.id, eventId: input.eventId, name, status })
    return actionOk({ planId: plan.id })
  } catch (error) {
    return actionFailure(error)
  }
}

export async function saveRoundAction(
  input: RoundInput,
): Promise<ActionResult<{ roundId: RecordId }>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    const plan = await requirePlan(input.eventId, input.planId)

    const name = input.name.trim()
    if (name === '') {
      throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, 'the round needs a name', {
        planId: plan.id,
      })
    }

    const criteria = input.criteria.map(normalizeCriterion)
    const problems = criterionProblems(criteria)
    if (problems.length > 0) {
      const [first] = problems
      throw new AppError(
        ErrorIds.SUB_VALIDATION_FAIL,
        // The criterion is named by its LABEL and not its key, because the key is an
        // internal slug and the organizer is looking at a row that says "Relevance".
        `"${labelFor(criteria, first.key)}" ${first.message}`,
        { planId: plan.id, problems: problems.length },
      )
    }

    // Pared to people who really are on the event: a stale id from a reviewer who was
    // removed would otherwise be written into a link column and read back as a pool
    // member nobody can see or remove.
    const reviewerIds = await eventReviewerIds(input.eventId, input.reviewerIds)

    const draft = {
      eventId: input.eventId,
      planId: plan.id,
      name,
      criteria,
      // `null` and not `''`: Airtable rejects an empty string on a dateTime column, and
      // an organizer removing a round's close date is an ordinary thing to do.
      startsAt: input.startsAt.trim() === '' ? null : input.startsAt,
      endsAt: input.endsAt.trim() === '' ? null : input.endsAt,
      anonymous: input.anonymous,
      reviewerIds,
      maxPerReviewer: parseCap(input.maxPerReviewer),
    }

    if (input.roundId === undefined) {
      const rounds = await listRounds(input.eventId)
      const order = rounds.filter((round) => round.planId === plan.id).length + 1
      const roundId = await createRound({ ...draft, order })
      return actionOk({ roundId })
    }

    const round = await requireRound(input.eventId, plan.id, input.roundId)
    await updateRound({ ...draft, roundId: round.id })
    return actionOk({ roundId: round.id })
  } catch (error) {
    return actionFailure(error)
  }
}

// THERE IS NO `reorderRoundsAction`. One lived here, fully written and `admin`-guarded: it
// took the plan's whole ordered list of round ids and rewrote each row's `order`. Nothing
// ever called it. There is no drag handle, no move up/down and no dnd-kit anywhere under
// `evaluation/plan/`, and no module imported it, so the only reachable caller was a POST
// crafted by hand. Deleted 2026-08-10.
//
// Its reasoning is kept because whoever builds round re-ordering needs it: take the WHOLE
// ordered list in one call rather than a per-move write. `order` is a plain number on each
// row, so writing one round's new position and leaving its neighbours alone is how two rounds
// end up both claiming position 2, after which the tab strip shows them in an order that
// changes between reads.

export async function deleteRoundAction(input: {
  eventId: RecordId
  planId: RecordId
  roundId: RecordId
}): Promise<ActionResult<{ deleted: RecordId }>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    const plan = await requirePlan(input.eventId, input.planId)
    const round = await requireRound(input.eventId, plan.id, input.roundId)

    // `deleteRound` refuses a round that has anything in it. See the note there.
    await deleteRound({ eventId: input.eventId, roundId: round.id })
    return actionOk({ deleted: round.id })
  } catch (error) {
    return actionFailure(error)
  }
}

function assertStatus(value: string): PlanStatus {
  const status = PLAN_STATUSES.find((known) => known === value)
  if (status === undefined) {
    throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, `"${value}" is not a plan status`, {
      allowed: [...PLAN_STATUSES],
    })
  }
  return status
}

function labelFor(criteria: readonly Criterion[], key: string | undefined): string {
  const criterion = criteria.find((candidate) => candidate.key === key)
  if (criterion === undefined) return 'That criterion'
  return criterion.label === '' ? 'The unnamed criterion' : criterion.label
}

/** The plan, resolved against the authorized event. See the file header. */
async function requirePlan(eventId: RecordId, planId: RecordId): Promise<EvaluationPlan> {
  const plan = (await listEvaluationPlans(eventId)).find((candidate) => candidate.id === planId)
  if (plan === undefined) {
    throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that plan is not on this event', {
      eventId,
      planId,
    })
  }
  return plan
}

/** The round, resolved against the authorized event AND the plan it is claimed to be in. */
async function requireRound(
  eventId: RecordId,
  planId: RecordId,
  roundId: RecordId,
): Promise<Round> {
  const round = (await listRounds(eventId)).find(
    (candidate) => candidate.id === roundId && candidate.planId === planId,
  )
  if (round === undefined) {
    throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that round is not in this plan', {
      eventId,
      planId,
      roundId,
    })
  }
  return round
}

async function eventReviewerIds(
  eventId: RecordId,
  requested: readonly RecordId[],
): Promise<readonly RecordId[]> {
  if (requested.length === 0) return []
  const onEvent = new Set((await listEventReviewers(eventId)).map((person) => person.id))
  return requested.filter((id) => onEvent.has(id))
}
