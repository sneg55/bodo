// What `actionFailure` does with each kind of error, which is why a refusal must be an AppError.
//
// This is the rule underneath `decision-preview-refusals.test.ts`. That file checks the three
// refusals in one action; this one checks the fork every action shares. `actionFailure` returns
// a renderable failure for an `AppError` and RE-THROWS anything else, and a re-throw out of a
// Server Action is not an error message -- Next answers it with an opaque digest and the route
// dies. `/admin/{eventId}/abstracts` went down with `ERROR 3709058310` exactly that way.
//
// The re-throw itself is correct and stays: a bug inside an action must not be dressed up as a
// sentence written for the user. What was wrong was a CALLER reaching for it to refuse a state
// an organizer hits by selecting the wrong row. Both halves are pinned here so the next person
// adding a refusal can see which side of the fork they are on.

import { describe, expect, it } from 'vitest'

import { AppError, ErrorIds } from '@/constants/errorIds'
import { actionFailure } from '@/features/review/action-result'

describe('actionFailure', () => {
  it('turns an AppError into a message the caller can render', () => {
    const result = actionFailure(
      new AppError(ErrorIds.SUB_NOT_STAGED, 'that submission is not staged', {
        submissionId: 'recSub1',
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.errorId).toBe(ErrorIds.SUB_NOT_STAGED)
    expect(result.message).toBe('that submission is not staged')
  })

  it('rethrows anything else, because an unexpected failure is not user-facing copy', () => {
    // The behaviour that made the crash possible, asserted so it reads as a decision rather
    // than a surprise. A plain Error escaping here rejects the Server Action.
    expect(() => actionFailure(new Error('a bug, not a refusal'))).toThrow('a bug, not a refusal')
    expect(() => actionFailure('a rejected string')).toThrow()
  })
})
