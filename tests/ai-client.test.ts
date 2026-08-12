// What the boundary does with a response, which is the half of the AI integration that
// can be tested without a network.
//
// Every case here is a way the model can hand back something that is not the answer, and
// the point of each assertion is that the caller finds out. A refusal reported as a
// parse failure sends someone to debug the schema; a truncated answer parsed as complete
// ships half a review to an organizer as if it were whole.

import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { ErrorIds, isAppError } from '@/constants/errorIds'
import { type AiMessageLike, parseAiMessage } from '@/services/ai/client'
import {
  AI_MAX_RETRIES,
  AI_REQUEST_TIMEOUT_MS,
  AI_RETRY_BACKOFF_CEILING_MS,
  AI_WORST_CASE_CALL_MS,
} from '@/services/ai/limits'

function idOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (isAppError(error)) return error.id
    return `not an AppError: ${String(error)}`
  }
  return 'did not throw'
}

const OK: AiMessageLike = {
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: '{"answer":"three speakers","refs":[]}' }],
}

describe('parseAiMessage, the happy path', () => {
  it('returns the parsed structured output', () => {
    expect(parseAiMessage<{ answer: string }>(OK).answer).toBe('three speakers')
  })

  it('ignores thinking blocks, which this model emits by default', () => {
    // Thinking is on by default on claude-opus-5, so a response that also carries a
    // thinking block is the NORMAL case, not an edge one. Concatenating it into the
    // JSON would fail every single call.
    const withThinking: AiMessageLike = {
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', text: 'Let me count the speakers without a bio.' },
        { type: 'text', text: '{"answer":"three speakers","refs":[]}' },
      ],
    }
    expect(parseAiMessage<{ answer: string }>(withThinking).answer).toBe('three speakers')
  })
})

describe('parseAiMessage, a refusal is a decision, not a parse failure', () => {
  it('raises LLM_REFUSED when the classifiers declined', () => {
    expect(idOf(() => parseAiMessage({ stop_reason: 'refusal', content: [] }))).toBe(
      ErrorIds.LLM_REFUSED,
    )
  })

  it('raises LLM_REFUSED even when a partial answer came with it', () => {
    // A mid-stream refusal leaves readable text behind. Parsing it would render the
    // half the model decided not to finish as though it were the answer.
    const partial: AiMessageLike = {
      stop_reason: 'refusal',
      content: [{ type: 'text', text: '{"answer":"partial' }],
    }
    expect(idOf(() => parseAiMessage(partial))).toBe(ErrorIds.LLM_REFUSED)
  })
})

describe('parseAiMessage, truncation is never returned as an answer', () => {
  it('raises LLM_CONTEXT_OVERFLOW when max_tokens cut the response', () => {
    // max_tokens caps thinking PLUS the answer on this model, so a cap sized for the
    // answer alone truncates. That has to surface, not parse.
    const cut: AiMessageLike = {
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"answer":"partial' }],
    }
    expect(idOf(() => parseAiMessage(cut))).toBe(ErrorIds.LLM_CONTEXT_OVERFLOW)
  })

  it('raises LLM_CONTEXT_OVERFLOW when the context window was exceeded', () => {
    const over: AiMessageLike = { stop_reason: 'model_context_window_exceeded', content: [] }
    expect(idOf(() => parseAiMessage(over))).toBe(ErrorIds.LLM_CONTEXT_OVERFLOW)
  })
})

describe('parseAiMessage, malformed output', () => {
  it('raises LLM_BAD_RESPONSE when there is no text block at all', () => {
    const empty: AiMessageLike = { stop_reason: 'end_turn', content: [{ type: 'thinking' }] }
    expect(idOf(() => parseAiMessage(empty))).toBe(ErrorIds.LLM_BAD_RESPONSE)
  })

  it('raises LLM_BAD_RESPONSE when the text is not JSON', () => {
    const prose: AiMessageLike = {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Sure! Here are the speakers:' }],
    }
    expect(idOf(() => parseAiMessage(prose))).toBe(ErrorIds.LLM_BAD_RESPONSE)
  })

  it('raises LLM_BAD_RESPONSE when the JSON is not an object', () => {
    // Structured output should make this unreachable. It is checked anyway because
    // every caller immediately reads a property off the result.
    const scalar: AiMessageLike = {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '"just a string"' }],
    }
    expect(idOf(() => parseAiMessage(scalar))).toBe(ErrorIds.LLM_BAD_RESPONSE)
  })
})

describe('the call is bounded, because a caller holds a lease across it', () => {
  it('derives the worst case from the timeout and the retries, waiting included', () => {
    expect(AI_WORST_CASE_CALL_MS).toBe(
      (AI_MAX_RETRIES + 1) * AI_REQUEST_TIMEOUT_MS + AI_MAX_RETRIES * AI_RETRY_BACKOFF_CEILING_MS,
    )
  })

  it('stays far inside the SDK defaults of ten minutes and two retries', () => {
    // Unbounded in practice is what the defaults amount to here: three attempts of ten
    // minutes is over half an hour for one abstract, which no lease is sized for and which
    // spans fifteen ticks of the two-minute prescreen cron.
    expect(AI_REQUEST_TIMEOUT_MS).toBeLessThan(10 * 60_000)
    expect(AI_MAX_RETRIES).toBeLessThan(2)
    expect(AI_WORST_CASE_CALL_MS).toBeLessThan(3 * 10 * 60_000)
  })

  it('hands both to the SDK rather than leaving the defaults in place', async () => {
    // Asserted against the source because the alternative is a network call: the request
    // options are the second argument to `messages.create`, and nothing about the parsed
    // response says whether they were passed.
    const source = await readFile('src/services/ai/client.ts', 'utf8')

    expect(source).toContain('timeout: AI_REQUEST_TIMEOUT_MS')
    expect(source).toContain('maxRetries: AI_MAX_RETRIES')
  })

  it('keeps the limits importable without dragging the SDK along', async () => {
    // The `notice.ts` lesson, and this one is load-bearing: `PRESCREEN_LEASE_MS` is derived
    // from `AI_WORST_CASE_CALL_MS`, and prescreen-queue.ts is imported by a client panel.
    const source = await readFile('src/services/ai/limits.ts', 'utf8')

    expect(source).not.toContain("from '@anthropic-ai/sdk'")
    expect(source).not.toContain("from '@/services/ai/client'")
  })
})
