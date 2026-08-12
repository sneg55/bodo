// The contract with the model: the round's criteria as a JSON schema, the prompt halves,
// what a valid answer is, and what to say when there is no API key.
//
// Pure and Airtable-free, because everything worth getting right here is about the shape
// of an answer rather than about a record. `src/services/ai/client.ts` already turned the
// response into a JSON object and already reported a refusal or a truncation as itself;
// this file's job starts one step later, at "is this object a review of THIS round".
//
// **Unknown criterion keys are dropped, not rejected.** A round's criteria are editable
// after a pre-screen is queued, and the schema is only a request: the model can still
// answer for a criterion that no longer exists, and a whole submission losing its score
// over one stale key is worse than a review with one fewer criterion. `scoring.ts` counts
// what is present and reports `usedCriteria`, so a thin review is already visible.
//
// **Out-of-range scores are kept.** That is not laziness, it is the same decision
// `scoring.ts` documents for stored history: it clamps rather than rejects, so a 9 against
// a 1-5 criterion arrives as a 5 and the rest of the review survives. Clamping here as
// well would put the same rule in two places, and they would eventually disagree.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { REVIEW_RECOMMENDATIONS, type ReviewRecommendation } from '@/constants/status'
import type { Criterion, RecordId, Submission } from '@/types/domain'

/** What the model is shown of one abstract. Narrow, so the prompt cannot leak a mailbox. */
export type PrescreenSubmission = {
  readonly id: RecordId
  readonly code: string
  readonly title: string
  /** The submitted answers, flattened to prose. Empty when the form asked nothing. */
  readonly abstract: string
}

export type PrescreenResult = {
  readonly scores: Record<string, number>
  readonly comment: string
  readonly recommendation: ReviewRecommendation
}

/** Prefixed onto every comment this pipeline writes. See `labelledComment`. */
export const AI_REVIEW_LABEL = 'AI pre-screen'

/**
 * Thinking is on by default on `claude-opus-5` and `max_tokens` caps thinking plus the
 * answer together (`client.ts`), so this is sized for both. A rubric answer is small; the
 * headroom is the reasoning.
 */
export const PRESCREEN_MAX_TOKENS = 4_000

export const PRESCREEN_SYSTEM = [
  'You are screening conference talk submissions against a review rubric.',
  'Score every criterion you are given, using its own stated range.',
  'Judge only what the abstract actually says. Do not reward or penalise a speaker for',
  'anything you were not shown, and do not invent detail the submission does not contain.',
  'The comment is for the program committee, not the speaker: two or three sentences,',
  'naming the strongest and the weakest thing about the submission.',
].join(' ')

/**
 * A criterion the pre-screen may put a number against. Same rule as `countedCriteria` in
 * @/features/review/scoring, and it has to stay the same rule.
 *
 * Two conditions. The range must be wider than zero, or there is nothing to normalise. And
 * the kind must be `numeric`: a `text` criterion has no value at all, and a `select` one is
 * categorical, because normalising a dropdown against the span of its option values assumes
 * a higher value is a better answer and `Accept=1 / Maybe=2 / Reject=3` puts the best answer
 * at the floor. `scoring.ts` stopped counting dropdowns for that reason, so asking the model
 * to score one would produce a number that reaches the Reviews row and then contributes
 * nothing, which is worse than not asking.
 */
function scorable(criteria: readonly Criterion[]): readonly Criterion[] {
  return criteria.filter(
    (criterion) => criterion.kind === 'numeric' && criterion.max > criterion.min,
  )
}

/**
 * The round's rubric as `output_config.format`'s schema.
 *
 * `additionalProperties: false` on both objects is what makes the schema do work rather
 * than decorate the call: without it the model may answer for a criterion this round does
 * not have, and `parsePrescreenResult` would then be the only thing standing between a
 * hallucinated key and the Reviews row. Belt and braces, deliberately, because the schema
 * is a request the API enforces and the parse is a guarantee this code enforces.
 */
export function rubricJsonSchema(criteria: readonly Criterion[]): Record<string, unknown> {
  const usable = scorable(criteria)
  return {
    type: 'object',
    additionalProperties: false,
    required: ['scores', 'comment', 'recommendation'],
    properties: {
      scores: {
        type: 'object',
        additionalProperties: false,
        required: usable.map((criterion) => criterion.key),
        properties: Object.fromEntries(
          usable.map((criterion) => [
            criterion.key,
            {
              type: 'number',
              // The range is stated in the description, NOT as `minimum`/`maximum`. The API
              // rejects those two outright on a number: `output_config.format.schema: For
              // 'number' type, properties maximum, minimum are not supported`, HTTP 400,
              // which is not a soft failure. It failed every pre-screen job in the eval run
              // of 2026-08-10 ("0 scored", each job dead after its three attempts), and the
              // rows in AiPrescreenJobs carried the message the whole time.
              //
              // Nothing is lost by moving it. The bound reaches the model twice over, here
              // and in `rubricContext`, and an answer outside it was never rejected anyway:
              // the header above says out-of-range scores are kept and `scoring.ts` clamps.
              description: `${criterion.label} (${String(criterion.min)} to ${String(criterion.max)})`,
            },
          ]),
        ),
      },
      comment: { type: 'string' },
      recommendation: { enum: [...REVIEW_RECOMMENDATIONS] },
    },
  }
}

/**
 * The cacheable half of the prompt: the rubric, which is the same for every submission in
 * the round. It carries the cache breakpoint in `client.ts`, so a round of forty abstracts
 * pays for the rubric once and reads it forty times.
 */
export function rubricContext(criteria: readonly Criterion[]): string {
  const lines = scorable(criteria).map(
    (criterion) =>
      `- ${criterion.key} (${criterion.label}): ${String(criterion.min)} to ${String(criterion.max)}, weight ${String(criterion.weight)}`,
  )
  return ['# Rubric', ...(lines.length === 0 ? ['(no scorable criteria)'] : lines)].join('\n')
}

/** The volatile half: one submission, after the breakpoint. */
export function prescreenQuestion(submission: PrescreenSubmission): string {
  return [
    '# Submission',
    `code: ${submission.code}`,
    `title: ${submission.title}`,
    '',
    submission.abstract === '' ? '(the form collected no prose)' : submission.abstract,
  ].join('\n')
}

/**
 * Answers are stored as an untyped blob and a wysiwyg field holds HTML, so the tags come
 * off before the text reaches the prompt. Not for safety (nothing renders this), but
 * because markup is tokens the model pays for and reasons about: `<p>` in the middle of an
 * abstract is noise that a rubric score should not depend on.
 */
function plainText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const stripped = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped === '' ? undefined : stripped
}

/** A stored submission, reduced to what the model is shown. */
export function toPrescreenSubmission(submission: Submission): PrescreenSubmission {
  const answers = Object.entries(submission.answers).flatMap(([key, value]) => {
    const text = plainText(value)
    return text === undefined ? [] : [`${key}: ${text}`]
  })
  return {
    id: submission.id,
    code: submission.code,
    title: submission.title,
    abstract: answers.join('\n'),
  }
}

/** Every comment this pipeline writes says what wrote it, wherever the row is rendered. */
export function labelledComment(comment: string): string {
  const body = comment.trim()
  return body === '' ? `${AI_REVIEW_LABEL}: no comment returned.` : `${AI_REVIEW_LABEL}: ${body}`
}

function badResponse(detail: string, meta: Record<string, unknown> = {}): AppError {
  return new AppError(ErrorIds.LLM_BAD_RESPONSE, `the pre-screen answer ${detail}`, meta)
}

/** Values are read through a Map: a dynamic key read on model output is an injection sink. */
function fieldsOf(raw: unknown): ReadonlyMap<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw badResponse('was not a JSON object', { kind: Array.isArray(raw) ? 'array' : typeof raw })
  }
  return new Map(Object.entries(raw))
}

export function parsePrescreenResult(
  raw: unknown,
  criteria: readonly Criterion[],
): PrescreenResult {
  const fields = fieldsOf(raw)

  // Checked first, and it is the only hard failure: a review with no recommendation is a
  // row `scoreSubmission` counts as an abstention, which would quietly turn a broken
  // response into a vote that was never cast.
  const recommendation = REVIEW_RECOMMENDATIONS.find(
    (known) => known === fields.get('recommendation'),
  )
  if (recommendation === undefined) {
    throw badResponse('carried no recognised recommendation', {
      allowed: REVIEW_RECOMMENDATIONS.join(', '),
    })
  }

  const known = new Set(scorable(criteria).map((criterion) => criterion.key))
  const rawScores = fields.get('scores')
  const scores: [string, number][] = []
  if (typeof rawScores === 'object' && rawScores !== null && !Array.isArray(rawScores)) {
    for (const [key, value] of Object.entries(rawScores)) {
      if (!known.has(key)) continue
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      scores.push([key, value])
    }
  }

  const comment = fields.get('comment')
  return {
    scores: Object.fromEntries(scores),
    comment: typeof comment === 'string' ? comment : '',
    recommendation,
  }
}

/** FNV-1a. Small, dependency-free, and stable across isolates, which is all this needs. */
function hash32(input: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * The keyless answer, computed from the submission and the rubric rather than canned.
 *
 * Derived rather than fixed for the reason `src/services/ai/mock.ts` gives: a demo where
 * every abstract scores identically proves nothing about the surface it is demonstrating,
 * and the Evaluation panel's whole point is that submissions rank differently. Same
 * submission and same rubric always give the same answer, so a re-run of the queue does
 * not reshuffle a round somebody is looking at.
 */
export function mockPrescreenResult(
  submission: PrescreenSubmission,
  criteria: readonly Criterion[],
): PrescreenResult {
  const usable = scorable(criteria)
  const scores: [string, number][] = []
  let fractionSum = 0

  for (const criterion of usable) {
    const span = Math.floor(criterion.max) - Math.ceil(criterion.min) + 1
    const offset = span <= 0 ? 0 : hash32(`${submission.id}:${criterion.key}`) % span
    const value = Math.ceil(criterion.min) + offset
    scores.push([criterion.key, value])
    fractionSum += (value - criterion.min) / (criterion.max - criterion.min)
  }

  const mean = usable.length === 0 ? 0 : fractionSum / usable.length
  const recommendation: ReviewRecommendation = mean >= 0.7 ? 'yes' : mean >= 0.4 ? 'maybe' : 'no'

  return {
    scores: Object.fromEntries(scores),
    comment: [
      `Sample pre-screen of "${submission.title}".`,
      `Scored ${String(usable.length)} criteria from this round's rubric.`,
      'No model was called: set AI_MOCK=0 with an ANTHROPIC_API_KEY for a real assessment.',
    ].join(' '),
    recommendation,
  }
}
