// The HMAC key both token kinds are signed with.
//
// Split out of tokens.ts, which had grown past the file-size limit. The seam is a real
// one rather than an arbitrary cut: this is the only part of token handling that reads
// configuration, and everything left in tokens.ts takes its key as an argument and is
// therefore pure with respect to the environment. That is what lets the token tests
// sign with a fixed key and never touch `process.env`.

import { getEnv } from '@/utils/env'

const encoder = new TextEncoder()
let ephemeralDevSecret: Uint8Array | undefined

/**
 * `SESSION_SECRET` is optional outside production (src/utils/env.ts requires it at
 * `DEPLOY_ENV=production`), so local dev derives a random 32 byte key once per
 * isolate instead. The visible consequence, which is exactly what env.ts already
 * promises: the key dies with the process, so every cookie signed by it stops
 * verifying on restart and everyone is signed out. `next dev` boots either way.
 *
 * There is deliberately no hardcoded fallback. A constant would survive restarts
 * and would also be signing real sessions on any deploy that forgot the secret.
 */
export function authSecret(): Uint8Array {
  const configured = getEnv().SESSION_SECRET
  if (configured !== undefined) return encoder.encode(configured)
  ephemeralDevSecret ??= crypto.getRandomValues(new Uint8Array(32))
  return ephemeralDevSecret
}
