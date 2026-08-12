// What a question is allowed to be, and what the keyless path is allowed to claim.
//
// Split out of `ai-ask.test.ts`, which is at its size limit, and cohesive on its own: both
// halves are about a question or an answer that a Server Action will hand to an organizer
// without a model ever having been asked.
//
// **The upper bound is the finding.** `MIN_ASK_LENGTH` was checked and nothing checked the
// other end, so a paste, or a POST straight at the Server Action, could append a question of
// any size to a snapshot that is already the largest thing in the request. That is paid for
// before it fails, because an oversized request only comes back as
// `model_context_window_exceeded`. The keyless path had the same shape of problem: the
// sample answer quotes every distinct term it scanned for, so an unbounded question was an
// unbounded sample answer too.

import { describe, expect, it } from 'vitest'

import { ASK_MAX_TOKENS, askLengthProblem, MAX_ASK_LENGTH, MIN_ASK_LENGTH } from '@/features/ai/ask'
import { mockAskAnswer } from '@/features/ai/ask-mock'
import { AI_SAMPLE_NOTICE } from '@/services/ai/notice'
import { speaker, submission } from './helpers/ai-ask-fakes'

/** Roughly how many tokens a character budget buys, at the usual four characters a token. */
const CHARS_PER_TOKEN = 4

const ROWS = { submissions: [submission()], speakers: [speaker()] }

describe('askLengthProblem, both ends of what may reach the model', () => {
  it('refuses a prefix that is a search rather than a question', () => {
    expect(askLengthProblem('kub')).toContain(String(MIN_ASK_LENGTH))
  })

  it('accepts an ordinary question', () => {
    expect(askLengthProblem('which speakers have no biography yet')).toBeUndefined()
  })

  it('accepts a question of exactly the maximum', () => {
    expect(askLengthProblem('q'.repeat(MAX_ASK_LENGTH))).toBeUndefined()
  })

  it('refuses one character past the maximum', () => {
    expect(askLengthProblem('q'.repeat(MAX_ASK_LENGTH + 1))).toContain(String(MAX_ASK_LENGTH))
  })

  it('keeps the question small next to the budget it shares the request with', () => {
    // The bound is derived rather than round, and this is the derivation: the question may
    // not rival the model's own answer-and-thinking budget, let alone the snapshot that
    // dwarfs both. A question that can push a request over the context window on its own is
    // the failure the cap exists to prevent.
    expect(MAX_ASK_LENGTH).toBeGreaterThan(MIN_ASK_LENGTH)
    expect(MAX_ASK_LENGTH / CHARS_PER_TOKEN).toBeLessThan(ASK_MAX_TOKENS / CHARS_PER_TOKEN)
  })
})

describe('the mock echo, bounded because the question is', () => {
  it('cannot be blown up by a question full of distinct terms', () => {
    // Every distinct term of three characters or more is quoted back. A term costs its own
    // characters plus the `", ` around it, and each one needs a separator in the question,
    // so the echo stays within a small multiple of a question that is itself capped. The
    // assertion is that consequence, not the arithmetic.
    const question = Array.from({ length: MAX_ASK_LENGTH }, (_, index) => `t${index}`)
      .join(' ')
      .slice(0, MAX_ASK_LENGTH)

    expect(askLengthProblem(question)).toBeUndefined()
    expect(mockAskAnswer({ question, ...ROWS }).answer.length).toBeLessThan(MAX_ASK_LENGTH * 3)
  })
})

describe('the mock notice, which names the flag rather than diagnosing the deployment', () => {
  it('names AI_MOCK and claims nothing about a key', () => {
    // `AI_MOCK=1` selects the mock, not the absence of a key, and .env.example pairs a key
    // with `AI_MOCK=1` on purpose. On that deployment the old sentence told the organizer
    // something false, on all three surfaces it renders on.
    expect(AI_SAMPLE_NOTICE).toContain('AI_MOCK')
    expect(AI_SAMPLE_NOTICE.toLowerCase()).not.toContain('key')
  })

  it('says the same thing in the sample answer that renders under it', () => {
    // `configured` rather than `key`: the answer still calls itself a KEYWORD scan, which is
    // the true half of the old sentence and stays.
    const { answer } = mockAskAnswer({ question: 'which sessions talk about inference', ...ROWS })

    expect(answer).toContain('AI_MOCK')
    expect(answer.toLowerCase()).not.toContain('configured')
  })
})
