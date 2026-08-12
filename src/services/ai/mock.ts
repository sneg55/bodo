// The keyless path. Not a shortcut: it is how a clone with an empty `.env` demonstrates
// all three AI surfaces, and how the tests exercise them without a network.
//
// It returns whatever the request's own `mock()` computes, because only the feature
// knows what a plausible answer to its own question looks like, and each feature derives
// that from the same real event data the live call would have been given. So the mock
// output moves with the data rather than being a frozen string.
//
// Every surface that can show mock output says so. `isAiMocked()` in ./index.ts is what
// they gate on, because a canned answer that looks live is worse than no answer.

import type { AiClient, AiRequest } from '@/services/ai/client'

export const mockClient: AiClient = {
  complete: <T>(request: AiRequest<T>): Promise<T> => Promise.resolve(request.mock()),
}
