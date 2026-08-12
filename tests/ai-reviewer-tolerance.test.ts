// What the Abstracts and Evaluation surfaces are allowed to forgive when they ask who the
// AI reviewer is.
//
// The blanket `.catch(() => undefined)` these two surfaces used to carry was a correctness
// bug with no symptom: `ratingsBySubmission` and `humanReviews` exclude nothing when they
// are not told who the AI is, so a rate-limited or unreachable base produced a Ratings
// column that silently averaged the machine in with the committee. The seeded-or-not case
// is the only one that may become `undefined`; everything else has to reach the page.

import { describe, expect, it, vi } from 'vitest'

import { AppError, ErrorIds } from '@/constants/errorIds'
import { aiReviewerOrNone, isAiReviewerUnseeded } from '@/features/review/ai-reviewer'
import type { RecordId } from '@/types/domain'

const AI_ID = 'recAiReviewer'

const UNSEEDED = new AppError(
  ErrorIds.DATA_RECORD_NOT_FOUND,
  'no AdminUsers row for ai@system; run `npm run seed` to create the AI reviewer',
  { email: 'ai@system' },
)

function rejecting(error: Error): () => Promise<RecordId> {
  return () => Promise.reject(error)
}

describe('isAiReviewerUnseeded', () => {
  it('is true only for the not-found id', () => {
    expect(isAiReviewerUnseeded(UNSEEDED)).toBe(true)
  })

  it('is false for every other AppError id', () => {
    // The two that actually happen in production: the DAL gave up after backing off, and
    // the base answered with nothing usable. Both mean the reviewer row may well exist.
    expect(isAiReviewerUnseeded(new AppError(ErrorIds.DATA_RATE_LIMITED, 'gave up'))).toBe(false)
    expect(isAiReviewerUnseeded(new AppError(ErrorIds.NET_UNAVAILABLE, 'unreachable'))).toBe(false)
    expect(isAiReviewerUnseeded(new AppError(ErrorIds.DATA_SHAPE_INVALID, 'bad row'))).toBe(false)
    expect(isAiReviewerUnseeded(new AppError(ErrorIds.CFG_ENV_MISSING, 'no key'))).toBe(false)
  })

  it('is false for anything that is not an AppError', () => {
    expect(isAiReviewerUnseeded(new Error('E_DATA_001'))).toBe(false)
    expect(isAiReviewerUnseeded('E_DATA_001')).toBe(false)
    expect(isAiReviewerUnseeded(undefined)).toBe(false)
    expect(isAiReviewerUnseeded({ id: ErrorIds.DATA_RECORD_NOT_FOUND })).toBe(false)
  })
})

describe('aiReviewerOrNone', () => {
  it('answers with the id when the base is seeded', async () => {
    await expect(aiReviewerOrNone(() => Promise.resolve(AI_ID))).resolves.toBe(AI_ID)
  })

  it('answers with nothing when the ai@system row has never been seeded', async () => {
    await expect(aiReviewerOrNone(rejecting(UNSEEDED))).resolves.toBeUndefined()
  })

  it('rethrows an AppError with any other id', async () => {
    const rateLimited = new AppError(ErrorIds.DATA_RATE_LIMITED, 'gave up after 5 attempts')
    await expect(aiReviewerOrNone(rejecting(rateLimited))).rejects.toBe(rateLimited)
  })

  it('rethrows a plain Error', async () => {
    const boom = new Error('fetch failed')
    await expect(aiReviewerOrNone(rejecting(boom))).rejects.toBe(boom)
  })

  it('rethrows an Error that merely looks like the seed case', async () => {
    // The message and the id are both right and it is still not an `AppError`, so it is not
    // the seed case. Nothing in the app throws this; a library wrapping our error would.
    const impostor = Object.assign(new Error('no AdminUsers row for ai@system'), {
      id: ErrorIds.DATA_RECORD_NOT_FOUND,
    })
    await expect(aiReviewerOrNone(rejecting(impostor))).rejects.toBe(impostor)
  })

  it('asks the loader exactly once', async () => {
    // No retry here on purpose: the DAL already backs off, and a second attempt from a
    // render path would double the request on a base that is already rate limiting.
    const load = vi.fn(() => Promise.resolve(AI_ID))
    await aiReviewerOrNone(load)
    expect(load).toHaveBeenCalledTimes(1)
  })
})
