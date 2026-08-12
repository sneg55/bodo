// Which client is in play. One decision, one place.
//
// **Importing anything from this file pulls in `@anthropic-ai/sdk`**, because it imports
// `liveClient`. That is correct for server code and wrong for a `'use client'` file,
// where it ships 462 KB of SDK to the browser. Anything a client component needs lives in
// its own module for that reason: import `AI_SAMPLE_NOTICE` from `@/services/ai/notice`
// there, not from here.

import type { AiClient } from '@/services/ai/client'
import { liveClient } from '@/services/ai/client'
import { mockClient } from '@/services/ai/mock'
import { getEnv } from '@/utils/env'

export type { AiClient, AiEffort, AiRequest } from '@/services/ai/client'

/**
 * The flag is checked per call rather than resolved once at module load, because on
 * Workers a module is evaluated inside whichever isolate happens to serve the first
 * request and a cached decision would outlive a config change. Same as `getAccelClient`.
 */
export function getAiClient(): AiClient {
  return getEnv().AI_MOCK ? mockClient : liveClient
}

/**
 * Whether what came back was canned. Every surface that can render mock output checks
 * this and says so: a sample answer presented as a live one is the failure this whole
 * mock path would otherwise introduce.
 */
export function isAiMocked(): boolean {
  return getEnv().AI_MOCK
}

/**
 * Re-exported for server callers, who already have the SDK in their graph and for whom
 * this is the convenient import. A client component must import it from
 * `@/services/ai/notice` instead: see the header.
 */
export { AI_SAMPLE_NOTICE } from '@/services/ai/notice'
