// POST /api/cron/imports: authorize, then advance every import run that is due.
//
// The shape is /api/cron/accelevents' exactly: `assertCronAuthorized`, then one call into
// a feature function, then JSON out. The Worker logs non-success responses, so every
// failure is returned as JSON rather than thrown past the handler.
//
// AUTHORIZATION IS THE CRON GUARD'S AND STAYS THE CRON GUARD'S. This endpoint takes a
// shared secret in a header and knows nothing about organizers, events or memberships, so
// it must never become the thing an organizer's `Import` button calls. That button is a
// Server Action, it authorizes against `EventMemberships`, and it queues a run row; this
// route is what carries that row forward afterwards.
//
// `maxPhases: 1` is deliberate. A run advances one phase per invocation, so a 500-session
// event cannot spend one Worker request on more work than it can finish, and a CPU limit
// ends a phase rather than the run.

import { ErrorIds, isAppError } from '@/constants/errorIds'
import { fetchSource } from '@/features/imports/fetch-source'
import { type ImportSweepResult, sweepImportRuns } from '@/features/imports/sweep'
import { importWritePorts, readEventSpeakers } from '@/features/imports/write-ports'
import { assertCronAuthorized } from '@/features/jobs/cron-auth'
import {
  advanceImportRun,
  claimImportRun,
  finishImportRun,
} from '@/services/airtable/mutations-imports'
import {
  getImportRun,
  importRunLeaseHolder,
  listQueuedImportRuns,
  loadRemoteIndex,
} from '@/services/airtable/reads-imports'
import { createAccelReadClient } from '@/services/imports/accelevents-read'
import { fetchSessionizeAll } from '@/services/imports/sessionize'
import { claimOnce } from '@/utils/cf'

type RunJob = () => Promise<ImportSweepResult>

export async function handleImportsCron(request: Request, runJob: RunJob): Promise<Response> {
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
  return await handleImportsCron(request, runConfiguredSweep)
}

async function runConfiguredSweep(): Promise<ImportSweepResult> {
  return await sweepImportRuns({
    listDue: listQueuedImportRuns,
    getRun: getImportRun,
    heldBy: importRunLeaseHolder,
    claimRun: async (write, claim) => {
      await claimImportRun(write, claim, 'route')
    },
    advanceRun: async (write, progress) => {
      await advanceImportRun(write, progress, 'route')
    },
    finishRun: async (write, outcome) => {
      await finishImportRun(write, outcome, 'route')
    },
    loadRemoteIndex,
    // Uncached, and the Server Action's own function: the Needs-email list is a claim
    // about bodo's speaker rows, so it cannot come from the upstream payload and it cannot
    // differ between the two callers that advance the same run.
    readSpeakers: readEventSpeakers,
    fetch: async (request, guard) =>
      await fetchSource(request, guard, {
        sessionize: async (endpointId) => await fetchSessionizeAll(endpointId),
        // No Sessionboard client, and that is not an oversight: their organization token
        // is read for the duration of a run and stored nowhere, so a cron invocation has
        // nothing to present. `fetchSource` reports the absence and the sweep leaves the
        // run exactly as it found it, for a caller that does hold the token.
        accelevents: () => createAccelReadClient(),
      }),
    // One set of ports, shared with the Server Action path: see write-ports.ts.
    write: importWritePorts('route'),
    claim: claimOnce,
    // Unique per invocation. `claimOnce` re-grants to the SAME holder on purpose so a
    // retry does not deadlock against its own earlier lease, which means a holder derived
    // from anything stable would hand both overlapping sweeps the same run.
    holder: crypto.randomUUID(),
    now: () => new Date().toISOString(),
    maxPhases: 1,
  })
}

function statusFor(id: string): number {
  // 401 rather than 403, matching both existing cron endpoints: the caller presented no
  // usable credential rather than a credential lacking rights.
  if (id === ErrorIds.AUTH_FORBIDDEN_ROLE || id === ErrorIds.AUTH_NO_SESSION) return 401
  if (id === ErrorIds.CFG_ENV_MISSING || id === ErrorIds.CFG_SCHEMA_FAIL) return 503
  return 500
}
