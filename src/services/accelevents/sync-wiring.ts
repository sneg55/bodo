// The real boundaries behind the forward walk. One place, three callers.
//
// Kept out of sync.ts so that file imports nothing that touches Airtable or the network,
// which is what lets the walk be tested with fakes. This is the counterpart of
// `runConfiguredJob` in the cron route: the wiring is a handful of lines and every one of
// them is a decision, so it lives where all three entry points share it rather than being
// retyped in a Server Action.
//
// Two things worth knowing before calling it:
//
//   - It reads through `queries.ts`, which is CACHED, and that is deliberate. Every
//     mutation in this app expires the tags it touched (invalidate.ts), so a sync run
//     from a Server Action after a save sees the save. The one read that must never be
//     cached is the mapping list, because it decides create versus update, and
//     `listEventAcceleventsMappings` is a DAL read with no `ReadCache` for exactly that
//     reason.
//   - On a deployment with no Airtable base the walk fails on its FIRST call, with
//     `CFG_ENV_MISSING` out of `getClient()`, rather than pushing fixture rows to a real
//     Accelevents event. `ACCELEVENTS_MOCK` mocks the far side, not this one.

import { getAccelClient } from '@/services/accelevents'
import { hashAcceleventsPayload } from '@/services/accelevents/request-hash'
import type { ForwardSyncDeps } from '@/services/accelevents/sync-walk'
import {
  getAcceleventsIdentity,
  listEventAcceleventsMappings,
  saveIntegrationMapping,
  writeSyncLog,
} from '@/services/airtable/accelevents-sync'
import {
  getSpeaker,
  getSubmission,
  listForms,
  listRooms,
  listSubmissions,
  listTags,
  listTracks,
} from '@/services/airtable/queries'
import { claimOnce } from '@/utils/cf'

/**
 * Bind one run's dependencies.
 *
 * Called per run, not module-scoped, for two reasons that are both Workers rules rather
 * than style: `getAccelClient()` re-reads `ACCELEVENTS_MOCK` on every call so a cached
 * decision cannot outlive a config change, and `holder` must be unique per invocation.
 * `claimOnce` re-grants to the SAME holder on purpose (so a retry does not deadlock
 * against its own lease), which means a holder derived from anything stable would hand
 * one entity to two overlapping callers.
 */
export function forwardSyncDeps(): ForwardSyncDeps {
  return {
    getIdentity: getAcceleventsIdentity,
    listMappings: listEventAcceleventsMappings,
    getSpeaker,
    getSubmission,
    listSubmissions,
    listTracks,
    listTags,
    listRooms,
    listForms,
    client: getAccelClient(),
    saveMapping: saveIntegrationMapping,
    writeLog: writeSyncLog,
    hash: hashAcceleventsPayload,
    now: () => new Date().toISOString(),
    claim: claimOnce,
    holder: crypto.randomUUID(),
  }
}
