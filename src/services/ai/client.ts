// The Anthropic boundary. One call shape, one model, one place that knows what a
// refusal is.
//
// This is the only file in the tree allowed to import `@anthropic-ai/sdk`, enforced by
// `no-restricted-imports` in eslint.config.mjs, for the same reason the Airtable SDK is
// fenced off: a boundary that anyone can reach around stops being one.
//
// **Three response shapes are not answers, and each is reported as itself.** A refusal is
// a decision the model made, a truncation is a budget this code set too low, and
// unparseable text is a bug. Collapsing them into one error sends whoever is debugging to
// the wrong place, which is exactly what the error-id registry exists to prevent.
//
// **The snapshot carries the cache breakpoint and the question sits after it**, so asking
// a second question about the same event re-reads the digest from cache instead of paying
// for it again. The 512-token minimum on this model is cleared by any real event.
//
// **`max_tokens` caps thinking plus the answer**, because thinking is on by default on
// `claude-opus-5`. Every caller sizes the budget for both; a cap sized for the answer
// alone truncates mid-object and lands as LLM_CONTEXT_OVERFLOW.
//
// **Every call is bounded in wall-clock time**, by the constants in limits.ts rather than
// by the SDK's defaults. They live in their own module because a caller that holds a LEASE
// across this call has to size it against the bound, and the number must reach that caller
// without the SDK coming with it. See limits.ts and notice.ts.

import Anthropic from '@anthropic-ai/sdk'

import { AppError, ErrorIds } from '@/constants/errorIds'
import { AI_MAX_RETRIES, AI_REQUEST_TIMEOUT_MS } from '@/services/ai/limits'
import { getEnv } from '@/utils/env'

/** Fixed here rather than configurable: the prompts are written against this model. */
const MODEL = 'claude-opus-5'

export type AiEffort = 'low' | 'medium' | 'high'

export type AiRequest<T> = {
  /** Stable across calls of the same kind. Rendered before the context. */
  system: string
  /** The event snapshot. Cached. */
  context: string
  /** The volatile half. Sits after the cache breakpoint. */
  question: string
  /** JSON Schema for `output_config.format`. */
  schema: Record<string, unknown>
  /** Thinking AND answer share this budget. */
  maxTokens: number
  effort?: AiEffort
  /**
   * The canned answer for `AI_MOCK=1`, computed from the same inputs by the caller.
   *
   * It lives on the request rather than inside the mock client because only the feature
   * knows what a plausible answer to its own question looks like. That keeps this file
   * generic over three unrelated schemas and keeps each feature's canned logic next to
   * the data it is derived from.
   */
  mock: () => T
}

export type AiClient = { complete: <T>(request: AiRequest<T>) => Promise<T> }

/** The parts of a response this module reads. Narrow so tests need no SDK objects. */
export type AiMessageLike = {
  stop_reason: string | null
  content: readonly { type: string; text?: string }[]
}

/** Truncation, under either of the two names the API gives it. */
const TRUNCATED = new Set(['max_tokens', 'model_context_window_exceeded'])

export function parseAiMessage<T>(message: AiMessageLike): T {
  // Checked before the content is read, and in this order, because both of these can
  // arrive WITH readable text attached. A mid-stream refusal leaves a partial behind, and
  // so does a truncation; parsing either would present the fragment as the answer.
  if (message.stop_reason === 'refusal') {
    throw new AppError(ErrorIds.LLM_REFUSED, 'the model declined this request', {
      stopReason: message.stop_reason,
    })
  }
  if (message.stop_reason !== null && TRUNCATED.has(message.stop_reason)) {
    throw new AppError(ErrorIds.LLM_CONTEXT_OVERFLOW, 'the response did not fit the budget', {
      stopReason: message.stop_reason,
    })
  }

  // Only `text` blocks. Thinking is on by default on this model, so a response carrying a
  // thinking block is the normal case and folding it in would break every call.
  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')

  if (text.trim() === '') {
    throw new AppError(ErrorIds.LLM_BAD_RESPONSE, 'the response carried no text', {
      blocks: message.content.length,
    })
  }

  const parsed: unknown = parseJson(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AppError(ErrorIds.LLM_BAD_RESPONSE, 'the response was not a JSON object', {
      kind: Array.isArray(parsed) ? 'array' : typeof parsed,
    })
  }
  return parsed as T
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // The text itself is not logged: it is model output derived from event data, and
    // the length is enough to tell a refusal-shaped reply from a truncated object.
    throw new AppError(ErrorIds.LLM_BAD_RESPONSE, 'the response was not JSON', {
      length: text.length,
    })
  }
}

export const liveClient: AiClient = {
  async complete<T>(request: AiRequest<T>): Promise<T> {
    const apiKey = getEnv().ANTHROPIC_API_KEY
    if (apiKey === undefined) {
      // Unreachable while the env pairing holds; named so the message says which flag.
      throw new AppError(ErrorIds.LLM_NOT_CONFIGURED, 'AI_MOCK=0 but no ANTHROPIC_API_KEY is set')
    }

    // Constructed per call rather than at module scope: on Workers a module is evaluated
    // inside whichever isolate serves the first request, and a client cached there would
    // outlive a config change. Same reasoning as `getAccelClient`.
    const anthropic = new Anthropic({ apiKey })

    const message = await send(anthropic, request)
    return parseAiMessage<T>(message)
  },
}

async function send<T>(anthropic: Anthropic, request: AiRequest<T>): Promise<AiMessageLike> {
  try {
    return await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: request.maxTokens,
        system: [{ type: 'text', text: request.system }],
        messages: [
          {
            role: 'user',
            content: [
              // The breakpoint. Everything up to and including the snapshot is cacheable;
              // the question below it is not.
              { type: 'text', text: request.context, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: request.question },
            ],
          },
        ],
        output_config: {
          format: { type: 'json_schema', schema: request.schema },
          ...(request.effort === undefined ? {} : { effort: request.effort }),
        },
      },
      // Per-request rather than on the constructor: the second argument is the only one
      // that cannot be lost when a caller builds its own client, and both names are read
      // off the installed SDK's `RequestOptions` (internal/request-options.d.ts). The
      // timeout is per ATTEMPT, so the retries multiply it, which is what
      // `AI_WORST_CASE_CALL_MS` adds up.
      { timeout: AI_REQUEST_TIMEOUT_MS, maxRetries: AI_MAX_RETRIES },
    )
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      throw new AppError(ErrorIds.LLM_RATE_LIMITED, 'the model API is rate limiting this key')
    }
    const cause = error instanceof Error ? error.message : String(error)
    // Logged as well as attached, because the attached context goes nowhere an operator
    // can read: `actionFailure` sends the MESSAGE to the browser and drops the context, so
    // `AI_MOCK=0` failing looked identical whether the key was rejected, the model id was
    // wrong, or the runtime could not make the request at all. That cost a live debugging
    // session on the deployed Worker where the same request shape, key and model answered
    // 200 from a laptop. The SDK's own message names which of those it is; the status is
    // pulled out separately because an APIError carries it and a transport failure does not.
    // Narrowed rather than read straight off `APIError`, whose `status` is declared `any`
    // in the installed SDK, and an `any` flowing into a log line is how a number turns out
    // to have been an object all along.
    const status: number | undefined =
      error instanceof Anthropic.APIError && typeof error.status === 'number'
        ? error.status
        : undefined
    console.error(`[ai] ${MODEL} call failed status=${String(status)}: ${cause}`)
    throw new AppError(ErrorIds.LLM_UNAVAILABLE, 'the model API call failed', { cause, status })
  }
}
