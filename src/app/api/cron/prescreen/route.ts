// POST /api/cron/prescreen: authorize, then drain one batch of AI pre-screen jobs.
//
// Same shape as /api/cron/accelevents, deliberately down to the status codes: both are
// public URLs behind the same header and the same secret, and two cron endpoints that
// answer a refused secret differently is a difference somebody has to debug on the
// deployed Worker before they can tell which one is broken.
//
// Every failure is returned as JSON rather than thrown past the handler, because the
// Worker's `scheduled()` logs a non-success response body and can log nothing at all
// about an exception that escaped.

import { ErrorIds, isAppError } from '@/constants/errorIds'
import { assertCronAuthorized } from '@/features/jobs/cron-auth'
import type { PrescreenDrainResult } from '@/features/jobs/prescreen'
import { runConfiguredPrescreen } from '@/features/jobs/prescreen-wiring'

type RunJob = () => Promise<PrescreenDrainResult>

export async function handlePrescreenCron(request: Request, runJob: RunJob): Promise<Response> {
  try {
    assertCronAuthorized(request)
    const counts = await runJob()
    // A contended tick is not a failure: it means another tick holds the lease, which is
    // the guard doing its job. Only a job that actually failed makes this loud.
    return Response.json(counts, { status: counts.failed > 0 ? 502 : 200 })
  } catch (error) {
    if (isAppError(error)) {
      return Response.json(
        { ok: false, error: error.message, id: error.id },
        { status: statusFor(error.id) },
      )
    }
    const message = error instanceof Error ? error.message : String(error)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function POST(request: Request): Promise<Response> {
  return await handlePrescreenCron(request, runConfiguredPrescreen)
}

function statusFor(id: string): number {
  if (id === ErrorIds.AUTH_FORBIDDEN_ROLE || id === ErrorIds.AUTH_NO_SESSION) return 401
  if (id === ErrorIds.CFG_ENV_MISSING || id === ErrorIds.CFG_SCHEMA_FAIL) return 503
  // The seeded `ai@system` row is missing, which is a deployment that cannot pre-screen
  // at all rather than a bad request. 503 says "come back once this is configured".
  if (id === ErrorIds.DATA_RECORD_NOT_FOUND) return 503
  return 500
}
