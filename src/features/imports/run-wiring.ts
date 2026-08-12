// The real boundaries behind an import run, bound for a Server Action.
//
// The counterpart of `services/accelevents/sync-wiring.ts` and of `runConfiguredSweep` in
// `/api/cron/imports/route.ts`: the engine takes every dependency as a port precisely so a
// test can drive all four phases with fakes, which means somebody has to supply the real
// ones, and the wiring is a handful of lines of which every one is a decision. A file of
// its own rather than the top of actions.ts, because a `'use server'` module may only
// export async functions and none of this is one.
//
// TWO THINGS DIFFER FROM THE CRON ROUTE'S WIRING, and both are the reason this exists.
//
//   1. `origin` is `'action'`, not `'route'`. `invalidate` decides what expiry means from
//      that one word, and a default would hide that a Cron Trigger and an organizer's
//      button are different callers. It is the only argument the shared write ports take,
//      which is why they are now one factory in write-ports.ts rather than a set here and
//      a copy of it in the cron route: the same run is advanced a phase at a time by
//      either caller, and three separate write bugs had to be fixed twice while there
//      were two sets.
//   2. It CAN build a Sessionboard client, because it is handed the token. The cron sweep
//      cannot: there is deliberately no credential column on `ImportRuns`, so a scheduled
//      invocation has nothing to present, reports `no-client` and leaves the row exactly as
//      it found it for a caller that does hold one (BUILD_SPEC 5.0e). This wizard is that
//      caller, and it is the only one there will ever be.
//
// The token is a PARAMETER and stays in this closure. It is not written to a record, not
// put in an error context, and not carried onto anything the engine hands back.

import { fetchSource } from '@/features/imports/fetch-source'
import type { ImportPreviewDeps } from '@/features/imports/preview'
import type { ImportRunDeps } from '@/features/imports/run'
import { importWritePorts, readEventSpeakers } from '@/features/imports/write-ports'
import {
  advanceImportRun,
  claimImportRun,
  finishImportRun,
} from '@/services/airtable/mutations-imports'
import {
  getImportRun,
  importRunLeaseHolder,
  loadRemoteIndex,
} from '@/services/airtable/reads-imports'
import { createAccelReadClient } from '@/services/imports/accelevents-read'
import { createSessionboardClient } from '@/services/imports/sessionboard'
import { fetchSessionizeAll } from '@/services/imports/sessionize'
import { claimOnce } from '@/utils/cf'

/** What the wizard holds for the length of one request, and never longer. */
export type ImportRunSecrets = {
  /** Sessionboard organization token, `x-access-token`. Absent for the other two sources. */
  sessionboardToken?: string
}

/**
 * Bind one invocation's dependencies.
 *
 * Called per request rather than module-scoped, for the reason `forwardSyncDeps` is:
 * `holder` must be unique per invocation. `claimOnce` re-grants to the SAME holder on
 * purpose so a retry does not deadlock against its own earlier lease, which means a holder
 * derived from anything stable would hand one run to two overlapping callers.
 *
 * `maxPhases: 1` matches the cron route and for the same reason, which matters more here:
 * this runs inside an organizer's request, so a phase is the largest unit of work that
 * reliably fits under the Worker CPU limit. The wizard calls back for the next one and
 * shows the progress bar move, and a limit hit mid-phase ends the phase rather than the run
 * because `dueImportRuns` hands a `running` row back once its lease lapses.
 */
export function importRunDeps(secrets: ImportRunSecrets = {}): ImportRunDeps {
  return {
    getRun: getImportRun,
    heldBy: importRunLeaseHolder,
    claimRun: async (write, claim) => {
      await claimImportRun(write, claim, 'action')
    },
    advanceRun: async (write, progress) => {
      await advanceImportRun(write, progress, 'action')
    },
    finishRun: async (write, outcome) => {
      await finishImportRun(write, outcome, 'action')
    },
    loadRemoteIndex,
    // Uncached, and the same function the cron route passes: the Needs-email list must not
    // depend on which caller happened to finish the run.
    readSpeakers: readEventSpeakers,
    fetch: async (request, guard) => await fetchSource(request, guard, sourceClients(secrets)),
    // The cron route's set, built with origin `'action'`: see write-ports.ts for why the
    // two callers must not have their own.
    write: importWritePorts('action'),
    claim: claimOnce,
    holder: crypto.randomUUID(),
    now: () => new Date().toISOString(),
    maxPhases: 1,
  }
}

/**
 * The dry run's two dependencies, bound the same way the real run's are.
 *
 * Both halves are deliberately the SAME functions the engine gets. If the preview read the
 * far side through one path and the run through another, the counts an organizer approved
 * would not be the counts the run acts on, and the whole "nothing is written until the
 * organizer presses Import" promise would be about a different set of records.
 */
export function importPreviewDeps(secrets: ImportRunSecrets = {}): ImportPreviewDeps {
  return {
    loadRemoteIndex,
    fetch: async (request, guard) => await fetchSource(request, guard, sourceClients(secrets)),
  }
}

/**
 * The three read clients, each built only if this caller can.
 *
 * The Sessionboard entry takes the REGION and closes over the token, which is the shape
 * `SourceClients` asks for precisely so the credential never crosses into the engine: the
 * engine parses `<region>:<eventId>` off the run row and asks for a client, and what it
 * gets back is already authenticated by somebody else.
 *
 * A missing token leaves the entry absent rather than building a client with an empty
 * string. `fetchSource` then raises `IMPORT_NO_CLIENT`, which the engine reports as
 * `no-client` and which leaves the run resumable; an empty token would instead spend a
 * request to be told 401 and burn the run to `failed`.
 */
export function sourceClients(secrets: ImportRunSecrets) {
  const token = secrets.sessionboardToken
  return {
    sessionize: async (endpointId: string) => await fetchSessionizeAll(endpointId),
    accelevents: () => createAccelReadClient(),
    ...(token === undefined || token === ''
      ? {}
      : {
          sessionboard: (region: 'us' | 'eu') => createSessionboardClient({ region, token }),
        }),
  }
}
