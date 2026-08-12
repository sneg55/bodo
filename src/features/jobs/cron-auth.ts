// Shared authorization for the scheduled endpoints.
//
// `/api/cron/*` is a public URL. The scheduled handler in src/entrypoints/worker.ts
// presents CRON_SECRET, and so does the admin "run now" button, so there is exactly
// one auth path and no special case for the scheduler.
//
// The comparison is length-then-content rather than `===` so it does not leak the
// secret's length or its matching prefix through timing. That matters more here than
// it looks: this endpoint drains the outbox, so an attacker who can call it can make
// the app send its queued mail early.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getEnv } from '@/utils/env'

export const CRON_SECRET_HEADER = 'x-cron-secret'

export function assertCronAuthorized(request: Request): void {
  const expected = getEnv().CRON_SECRET
  if (expected === undefined) {
    // Not configured means not callable. Leaving the route open when the secret is
    // absent would make a forgotten env var into a public send button.
    throw new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'CRON_SECRET is not configured', {})
  }

  const presented = request.headers.get(CRON_SECRET_HEADER) ?? ''
  if (!timingSafeEqual(presented, expected)) {
    throw new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'cron secret did not match', {})
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return mismatch === 0
}
