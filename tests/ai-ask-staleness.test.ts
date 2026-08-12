// An ask answer belongs to exactly one question.
//
// Split out of ai-ask.test.ts, which was already at the file-size limit. Its own file
// suits it: everything there is about whether a REF can become a link, and this is about
// whether an ANSWER should still be on screen at all.
//
// The palette already dropped a reply that arrived for a question the organizer had typed
// past. What it did not do was stop showing one that had already arrived. The answer sat
// in state while the input changed underneath it, and since every answer row carries its
// question in its cmdk `value`, shortening the query into a prefix of the old question
// left the row matching and visible. That is the worst version of the bug: the answer
// looks like a reply to what is currently typed.

import { describe, expect, it } from 'vitest'

import { askForQuestion } from '@/features/ai/ask'

const SETTLED = { question: 'who has no bio yet' }

describe('askForQuestion', () => {
  it('keeps the answer while the question is unchanged', () => {
    expect(askForQuestion(SETTLED, 'who has no bio yet')).toBe(SETTLED)
  })

  it('drops it once the organizer types past the question', () => {
    expect(askForQuestion(SETTLED, 'who has no bio yet and no headshot')).toBeUndefined()
  })

  it('drops it when the question is SHORTENED into a prefix of itself', () => {
    // The exact shape the review found. cmdk still matches a prefix, so without this rule
    // the old answer stays on screen under a query it does not answer.
    expect(askForQuestion(SETTLED, 'who has no bio')).toBeUndefined()
  })

  it('is not fooled by a question that merely contains the old one', () => {
    expect(askForQuestion(SETTLED, 'tell me who has no bio yet')).toBeUndefined()
  })

  it('has nothing to show before the first ask', () => {
    expect(askForQuestion(undefined, 'anything')).toBeUndefined()
  })
})
