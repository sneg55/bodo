// Which client is in play. One decision, one place.

import type { AccelClient } from '@/services/accelevents/client'
import { liveClient } from '@/services/accelevents/client'
import { mockClient } from '@/services/accelevents/mock'
import { getEnv } from '@/utils/env'

export type {
  AccelClient,
  RemoteRef,
  SessionPayload,
  SpeakerPayload,
  TaxonomyPayload,
} from '@/services/accelevents/client'
export { DUPLICATE_EMAIL_CODE } from '@/services/accelevents/client'
export { mockCalls, resetMock } from '@/services/accelevents/mock'

/**
 * The flag is checked per call rather than resolved once at module load, because
 * on Workers a module is evaluated inside whichever isolate happens to serve the
 * first request and a cached decision would outlive a config change.
 */
export function getAccelClient(): AccelClient {
  return getEnv().ACCELEVENTS_MOCK ? mockClient : liveClient
}
