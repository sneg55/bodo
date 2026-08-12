// Step four: the evaluation plan, the committee, and partially scored reviews.
//
// Partial on purpose. Eight assignments and four reviews, one of which has a single
// criterion filled in and no recommendation at all: that is the state the Evaluation
// surface actually has to render, and a base where every reviewer has finished proves
// nothing about the half-done case. `scoring.ts` counts an absent recommendation as an
// abstention, so this seed is also what exercises that.
//
// Assignments are one row per (submission, round, reviewer), never a team-level row
// the reviewer queue then joins through: "assigned to me" stays a single lookup
// against a rate-limited API, and a reviewer removed from the committee keeps the work
// already in flight. Section 3.

import type { ReviewRecommendation } from '@/constants/status'
import { COL, TABLES } from '@/services/airtable/tables'
import { link } from '@/services/airtable/to-fields'
import { submissionRoundFields } from '@/services/airtable/to-fields-portal'
import { assignmentFields, reviewFields, roundFields } from '@/services/airtable/to-fields-review'
import type { Criterion } from '@/types/domain'
import type { Ensured, SeedContext } from './ensure'
import { idFor } from './ensure'
import { ADMINS, EVENT, PLAN, ROUNDS, TEAM } from './scenario'
import type { Content } from './steps-content'
import type { Foundation } from './steps-foundation'
import { AWAITING_REVIEW } from './submissions-data'

const CRITERIA = new Map<string, readonly Criterion[]>([
  [
    ROUNDS.screening,
    [
      { key: 'relevance', label: 'Relevance', kind: 'numeric', min: 1, max: 5, weight: 2 },
      { key: 'clarity', label: 'Clarity', kind: 'numeric', min: 1, max: 5, weight: 1 },
    ],
  ],
  [
    // Final mixes the three criterion kinds deliberately. A seeded base is the first
    // thing anybody opens, and a rubric of nothing but sliders would leave the editor's
    // dropdown and free-text kinds looking like features nobody uses.
    ROUNDS.final,
    [
      { key: 'depth', label: 'Technical Depth', kind: 'numeric', min: 1, max: 5, weight: 3 },
      {
        key: 'delivery',
        label: 'Speaker Delivery',
        kind: 'select',
        min: 1,
        max: 3,
        weight: 1,
        options: [
          { label: 'Needs coaching', value: 1 },
          { label: 'Solid', value: 2 },
          { label: 'Excellent', value: 3 },
        ],
      },
      // Weight 0: a free-text criterion carries no score, so it contributes nothing to
      // the weighted mean and `scoring.ts` drops it either way.
      {
        key: 'chairNotes',
        label: 'Anything the chair should know',
        kind: 'text',
        min: 0,
        max: 0,
        weight: 0,
      },
    ],
  ],
])

const REVIEWERS = [ADMINS.reviewerOne, ADMINS.reviewerTwo] as const

/**
 * Who has actually reviewed what, and how completely.
 *
 * Index into AWAITING_REVIEW, reviewer email, scores, recommendation. The third entry
 * scores one criterion of two and offers no recommendation, which is the half-done row.
 */
const SCORED: readonly (readonly [
  number,
  string,
  Record<string, number>,
  ReviewRecommendation?,
])[] = [
  [0, ADMINS.reviewerOne, { relevance: 5, clarity: 4 }, 'yes'],
  [0, ADMINS.reviewerTwo, { relevance: 3, clarity: 5 }, 'maybe'],
  [1, ADMINS.reviewerOne, { relevance: 4, clarity: 4 }, 'yes'],
  [2, ADMINS.reviewerOne, { relevance: 3 }, undefined],
]

async function seedPlan(
  ctx: SeedContext,
  foundation: Foundation,
): Promise<{ planId: string; rounds: Ensured }> {
  const plan = await ctx.ensure(
    TABLES.evaluationPlans,
    [COL.event, COL.name],
    [
      {
        [COL.name]: PLAN.name,
        [COL.event]: link(foundation.eventId),
        [COL.status]: 'active',
        [COL.createdAt]: EVENT.startsAt,
      },
    ],
  )

  const planId = idFor(plan, [link(foundation.eventId), PLAN.name], 'evaluation plan')
  const rounds = await ctx.ensure(
    TABLES.rounds,
    [COL.plan, COL.name],
    [ROUNDS.screening, ROUNDS.final].map((name, index) => ({
      [COL.name]: name,
      [COL.plan]: link(planId),
      [COL.event]: link(foundation.eventId),
      [COL.order]: index + 1,
      [COL.criteriaJson]: JSON.stringify(CRITERIA.get(name) ?? []),
      // Screening is blind and Final is not, which is the ordinary shape: a first pass
      // judged on the abstract alone, a final pass where who is speaking is part of the
      // decision. Seeding both the same way would leave the toggle looking decorative.
      [COL.anonymous]: name === ROUNDS.screening,
    })),
  )

  await settleRounds(ctx, foundation, planId, rounds)
  return { planId, rounds }
}

/**
 * Write the round CONFIGURATION over whatever is already there.
 *
 * An update, not a create, so it does not go through `ensure`, exactly as `placeSessions`
 * does not. It has to be: `ensure` keys on (plan, name) and only ever creates, so a base
 * seeded before the criterion kinds and the per-round settings existed keeps its two
 * numeric sliders forever and re-seeding reports "already present" while demonstrating
 * none of it. That is a gap in the seed rather than a one-off fix, because the seed is
 * supposed to describe a state, not just a set of rows.
 *
 * Idempotent: writing the same rubric and the same pool a second time leaves the round
 * exactly where it already was.
 *
 * The pool is deliberately ASYMMETRIC. Screening is open to everyone (an empty pool) and
 * Final is restricted to one reviewer, so the setting visibly constrains something:
 * seeding both open would make "everyone" and "restricted" look identical on screen.
 */
async function settleRounds(
  ctx: SeedContext,
  foundation: Foundation,
  planId: string,
  rounds: Ensured,
): Promise<void> {
  const reviewerId = (email: string): string => idFor(foundation.admins, [email], 'admin user')

  await ctx.client.updateRecords(
    TABLES.rounds,
    [ROUNDS.screening, ROUNDS.final].map((name) => ({
      id: idFor(rounds, [link(planId), name], 'round'),
      fields: roundFields({
        eventId: foundation.eventId,
        planId,
        criteria: CRITERIA.get(name) ?? [],
        anonymous: name === ROUNDS.screening,
        reviewerIds: name === ROUNDS.final ? [reviewerId(ADMINS.reviewerOne)] : [],
      }),
    })),
  )
}

async function seedCommittee(ctx: SeedContext, foundation: Foundation): Promise<string> {
  const teams = await ctx.ensure(
    TABLES.reviewTeams,
    [COL.event, COL.name],
    [
      {
        [COL.name]: TEAM.name,
        [COL.event]: link(foundation.eventId),
        [COL.description]: 'Screens every abstract in round one.',
      },
    ],
  )
  const teamId = idFor(teams, [link(foundation.eventId), TEAM.name], 'review team')

  await ctx.ensure(
    TABLES.reviewTeamMembers,
    [COL.team, COL.user],
    REVIEWERS.map((email) => ({
      [COL.team]: link(teamId),
      [COL.user]: link(idFor(foundation.admins, [email], 'admin user')),
      [COL.addedAt]: EVENT.startsAt,
    })),
  )

  return teamId
}

export async function seedReview(
  ctx: SeedContext,
  foundation: Foundation,
  content: Content,
): Promise<void> {
  const { planId, rounds } = await seedPlan(ctx, foundation)
  const teamId = await seedCommittee(ctx, foundation)

  // Everything below is round one. Advancing to Final is an admin action, so seeding
  // it would hand a judge a walkthrough step already taken.
  const roundId = idFor(rounds, [link(planId), ROUNDS.screening], 'screening round')

  const submissionId = (title: string): string =>
    idFor(content.submissions, [link(foundation.eventId), title], 'submission')
  const reviewerId = (email: string): string => idFor(foundation.admins, [email], 'admin user')

  await ctx.ensure(
    TABLES.submissionRounds,
    [COL.submission, COL.round],
    AWAITING_REVIEW.map((row) =>
      submissionRoundFields({
        submissionId: submissionId(row.title),
        roundId,
        status: 'in_review',
        enteredAt: row.submittedAt ?? EVENT.startsAt,
      }),
    ),
  )

  await ctx.ensure(
    TABLES.reviewAssignments,
    [COL.submission, COL.round, COL.reviewer],
    AWAITING_REVIEW.flatMap((row) =>
      REVIEWERS.map((email) =>
        assignmentFields({
          submissionId: submissionId(row.title),
          roundId,
          reviewerId: reviewerId(email),
          viaTeamId: teamId,
          assignedAt: row.submittedAt ?? EVENT.startsAt,
          source: 'team',
        }),
      ),
    ),
  )

  await ctx.ensure(
    TABLES.reviews,
    [COL.submission, COL.round, COL.reviewer],
    SCORED.map(([index, email, scores, recommendation]) =>
      reviewFields({
        submissionId: submissionId(AWAITING_REVIEW.at(index)?.title ?? ''),
        roundId,
        reviewerId: reviewerId(email),
        scores,
        recommendation,
        updatedAt: '2026-08-08T09:00:00.000Z',
      }),
    ),
  )
}
