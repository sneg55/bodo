// The rubric contract with the model, and the keyless mock held to the same contract.
//
// The queue's own decisions live in tests/ai-prescreen-queue.test.ts, and the drain in
// tests/ai-prescreen-drain.test.ts, because its interesting cases are all interleavings
// and it needs a whole dependency bag to say anything.

import { describe, expect, it } from 'vitest'

import { ErrorIds, isAppError } from '@/constants/errorIds'
import {
  mockPrescreenResult,
  parsePrescreenResult,
  rubricJsonSchema,
} from '@/features/jobs/prescreen-rubric'
import { scoreReview } from '@/features/review/scoring'
import type { Criterion } from '@/types/domain'

import { CRITERIA, SUBMISSION } from './helpers/prescreen-fixtures'

/**
 * The registry id of whatever a call threw, which is what identifies a failure here: the
 * message is written for a human and may be reworded. Same helper as tests/ai-client.test.ts.
 */
function idOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (isAppError(error)) return error.id
    return `not an AppError: ${String(error)}`
  }
  return 'did not throw'
}

describe('rubric schema', () => {
  it('turns a round rubric into one property per criterion, its range in the description', () => {
    expect(rubricJsonSchema(CRITERIA)).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['scores', 'comment', 'recommendation'],
      properties: {
        scores: {
          type: 'object',
          additionalProperties: false,
          required: ['relevance', 'clarity'],
          properties: {
            relevance: { type: 'number', description: 'Relevance (1 to 5)' },
            clarity: { type: 'number', description: 'Clarity (1 to 5)' },
          },
        },
        recommendation: { enum: ['yes', 'no', 'maybe'] },
      },
    })
  })

  it('carries no minimum or maximum, which the model API rejects on a number', () => {
    // Not a style preference. `minimum`/`maximum` on a number is a 400 from the structured
    // output endpoint, and because it is raised per call it killed every pre-screen job in
    // the 2026-08-10 eval run rather than degrading one. `toMatchObject` above would pass
    // with them still present, so this asserts the absence directly.
    const scores = (rubricJsonSchema(CRITERIA).properties as Record<string, unknown>).scores
    const properties = (scores as { properties: Record<string, Record<string, unknown>> })
      .properties

    for (const property of Object.values(properties)) {
      expect(property).not.toHaveProperty('minimum')
      expect(property).not.toHaveProperty('maximum')
    }
  })

  it('drops a criterion with a zero-width range, which cannot carry a score', () => {
    const schema = rubricJsonSchema([
      ...CRITERIA,
      { key: 'fixed', label: 'Fixed', kind: 'numeric', min: 3, max: 3, weight: 1 },
    ])
    const scores = (schema.properties as Record<string, { required: readonly string[] }>).scores

    expect(scores.required).toEqual(['relevance', 'clarity'])
  })
})

describe('parsing what the model returned', () => {
  it('drops a criterion key the round does not define', () => {
    const parsed = parsePrescreenResult(
      {
        scores: { relevance: 4, clarity: 3, novelty: 5 },
        comment: 'Solid.',
        recommendation: 'yes',
      },
      CRITERIA,
    )

    expect(parsed.scores).toEqual({ relevance: 4, clarity: 3 })
    expect(parsed.recommendation).toBe('yes')
  })

  it('drops a score that is not a finite number rather than writing NaN to Airtable', () => {
    const parsed = parsePrescreenResult(
      { scores: { relevance: 'high', clarity: 3 }, comment: '', recommendation: 'maybe' },
      CRITERIA,
    )

    expect(parsed.scores).toEqual({ clarity: 3 })
  })

  it('keeps an out-of-range score so scoring.ts clamps it, per its own contract', () => {
    // scoring.ts documents clamping rather than rejection: a criterion narrowed after a
    // review landed is normal history. Rejecting here would delete a whole review over
    // one cell, which is the failure that comment exists to rule out.
    const parsed = parsePrescreenResult(
      { scores: { relevance: 9, clarity: 3 }, comment: '', recommendation: 'yes' },
      CRITERIA,
    )
    expect(parsed.scores.relevance).toBe(9)

    expect(scoreReview({ scores: { relevance: 9 } }, CRITERIA).weightedMean).toBe(
      scoreReview({ scores: { relevance: 5 } }, CRITERIA).weightedMean,
    )
  })

  it('refuses a response whose recommendation is not one of the three', () => {
    const thrown = idOf(() =>
      parsePrescreenResult(
        { scores: { relevance: 4 }, comment: 'x', recommendation: 'strong yes' },
        CRITERIA,
      ),
    )

    expect(thrown).toBe(ErrorIds.LLM_BAD_RESPONSE)
  })

  it('refuses a response that is not an object at all', () => {
    expect(idOf(() => parsePrescreenResult(['yes'], CRITERIA))).toBe(ErrorIds.LLM_BAD_RESPONSE)
  })
})

describe('the keyless mock', () => {
  it('is deterministic for the same submission and rubric', () => {
    expect(mockPrescreenResult(SUBMISSION, CRITERIA)).toEqual(
      mockPrescreenResult(SUBMISSION, CRITERIA),
    )
  })

  it('moves with the submission, so two abstracts do not score identically', () => {
    expect(mockPrescreenResult({ ...SUBMISSION, id: 'recSub2' }, CRITERIA).scores).not.toEqual(
      mockPrescreenResult(SUBMISSION, CRITERIA).scores,
    )
  })

  it('keeps every score inside its own criterion range', () => {
    const wide: readonly Criterion[] = [
      { key: 'impact', label: 'Impact', kind: 'numeric', min: 0, max: 100, weight: 1 },
      { key: 'relevance', label: 'Relevance', kind: 'numeric', min: 1, max: 5, weight: 1 },
    ]
    const result = mockPrescreenResult(SUBMISSION, wide)

    expect(result.scores.impact).toBeGreaterThanOrEqual(0)
    expect(result.scores.impact).toBeLessThanOrEqual(100)
    expect(result.scores.relevance).toBeGreaterThanOrEqual(1)
    expect(result.scores.relevance).toBeLessThanOrEqual(5)
  })

  it('says in the comment that no model was called', () => {
    expect(mockPrescreenResult(SUBMISSION, CRITERIA).comment).toContain('No model was called')
  })
})
