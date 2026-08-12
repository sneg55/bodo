// POST /api/cron/accelevents: authorize, then run the shared retry job.
//
// The Worker logs non-success responses, so every failure is returned as JSON
// rather than thrown past the route handler.

import { ErrorIds, isAppError } from '@/constants/errorIds'
import {
  type AcceleventsSyncResult,
  retryFailedAcceleventsSyncs,
} from '@/features/jobs/accelevents-sync'
import { assertCronAuthorized } from '@/features/jobs/cron-auth'
import { getAccelClient } from '@/services/accelevents'
import {
  getAcceleventsEventUrl,
  listAcceleventsMappings,
  listFailedSyncLogs,
  saveIntegrationMapping,
  writeSyncLog,
} from '@/services/airtable/accelevents-sync'
import { claimOnce } from '@/utils/cf'

type RunJob = () => Promise<AcceleventsSyncResult>

export async function handleAcceleventsCron(request: Request, runJob: RunJob): Promise<Response> {
  try {
    assertCronAuthorized(request)
    const counts = await runJob()
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
  return await handleAcceleventsCron(request, runConfiguredJob)
}

async function runConfiguredJob(): Promise<AcceleventsSyncResult> {
  return await retryFailedAcceleventsSyncs({
    listFailed: listFailedSyncLogs,
    // Accelevents rows only, ids unprefixed. The unscoped `listIntegrationMappings`
    // carries every provider's rows for the importers' reverse lookup, and a Sessionize
    // id reaching this sweep would be PUT against the Accelevents API.
    listMappings: listAcceleventsMappings,
    getEventUrl: getAcceleventsEventUrl,
    client: getAccelClient(),
    saveMapping: saveIntegrationMapping,
    writeLog: writeSyncLog,
    now: () => new Date().toISOString(),
    claim: claimOnce,
    // Unique per invocation. `claimOnce` re-grants to the SAME holder on purpose, so that
    // a retry does not deadlock against its own earlier lease, which means a holder
    // derived from anything stable would hand both overlapping sweeps the same entity.
    holder: crypto.randomUUID(),
  })
}

function statusFor(id: string): number {
  // 401, matching /api/cron/reminders. Both cron endpoints authenticate the same way,
  // with the same header and the same secret, so they must answer a refused secret with
  // the same status. This route said 403 and the other said 401, which was visible the
  // first time both were called against the deployed Worker. 401 is the accurate one:
  // the caller presented no usable credential rather than a credential lacking rights.
  if (id === ErrorIds.AUTH_FORBIDDEN_ROLE || id === ErrorIds.AUTH_NO_SESSION) return 401
  if (id === ErrorIds.CFG_ENV_MISSING || id === ErrorIds.CFG_SCHEMA_FAIL) return 503
  return 500
}
