// ImportRuns writes: queue a run, record a claim, write progress, write an outcome.
//
// **The status and lease columns are not a lock.** Airtable has no transaction and no
// compare-and-swap, so two overlapping cron invocations can both read a row as `queued`,
// both write `running`, and both start importing. Nothing in this file prevents that and
// nothing in it is trying to: atomic claiming is `claimOnce()` in `@/utils/cf.ts`, backed
// by the ClaimGuard Durable Object, keyed `import:<runId>` (BUILD_SPEC 5.0e, step 2).
// These functions PERSIST the outcome of a decision that was already made there. Anyone
// reading `status`, `leaseHolder` or `leaseExpiresAt` as the thing that grants the lease
// has the design backwards, and the bug it produces is an event imported twice, with the
// second pass creating everything the first one had not mapped yet.
//
// Every write names `eventIntegrationsTag(eventId)`, which is the tag the provider
// registry row and its run history are read under. The event id is carried on the write
// rather than read back from the row, exactly as `OutboxWrite` carries it: recording
// progress once per phase must not cost an extra Airtable request per phase against the
// ~5 req/s per-base cap (§3.1).
//
// `origin` is required on every function rather than defaulting, for the reason
// mutations-outbox.ts gives: the sweep is a Route Handler reached from a Cron Trigger and
// the wizard's `Import` is a Server Action, and a default would hide that they differ.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import type { FieldSet } from '@/services/airtable/records'
import { TABLES } from '@/services/airtable/tables'
import { eventIntegrationsTag } from '@/services/airtable/tags'
import {
  type ImportRunClaim,
  type ImportRunDraft,
  type ImportRunOutcome,
  type ImportRunProgress,
  importRunClaimFields,
  importRunFields,
  importRunOutcomeFields,
  importRunProgressFields,
} from '@/services/airtable/to-fields-imports'
import type { RecordId } from '@/types/domain'

/** Which row is being written, and which event's screens that expires. */
export type ImportRunWrite = {
  runId: RecordId
  /** Carried by the caller so a per-phase write costs no extra read. */
  eventId: RecordId
}

async function patchRun(
  write: ImportRunWrite,
  fields: FieldSet,
  origin: WriteOrigin,
): Promise<void> {
  await getClient().updateRecords(TABLES.importRuns, [{ id: write.runId, fields }])
  invalidate(origin, { own: [eventIntegrationsTag(write.eventId)] })
}

/**
 * Queue one run. Nothing is imported yet, and nothing is fetched yet either.
 *
 * Created before any work starts and never after it, because the row IS the resume point:
 * a run whose row appeared once the writing was underway would have no record of the
 * phases that came before it, and a Worker CPU limit hit in between would leave records
 * in the base with nothing pointing at them. The preview the organizer approved is a dry
 * run against the far side only (BUILD_SPEC 5.0e), so nothing local has been touched at
 * the moment this row is written.
 *
 * A plain create rather than an upsert: a re-import is deliberately a NEW history row, so
 * the provider registry shows what each attempt did. There is no natural key to merge on
 * and inventing one would collapse a re-run onto the run it is retrying.
 */
export async function createImportRun(
  draft: ImportRunDraft,
  origin: WriteOrigin,
): Promise<RecordId> {
  const created = (await getClient().createRecords(TABLES.importRuns, [importRunFields(draft)])).at(
    0,
  )
  if (created === undefined) {
    // Airtable answering a create with no record means the row's identity is unknown,
    // and every later write needs it. Failing here is recoverable; returning a made-up
    // id would have the run write its progress into nothing.
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'ImportRuns create returned no record', {
      eventId: draft.eventId,
      source: draft.source,
    })
  }

  invalidate(origin, { own: [eventIntegrationsTag(draft.eventId)] })
  return created.id
}

/**
 * Record that a run is being worked on.
 *
 * Call this ONLY after `claimOnce('import:<runId>', holder, ttl)` returned
 * `granted: true`. It does not check, because it cannot: see the header.
 */
export async function claimImportRun(
  write: ImportRunWrite,
  claim: ImportRunClaim,
  origin: WriteOrigin,
): Promise<void> {
  await patchRun(write, importRunClaimFields(claim), origin)
}

/**
 * Write where the run got to, once per phase.
 *
 * This is the write that makes an interrupted run resumable, so it happens AFTER the
 * phase's records are in Airtable and not before. Advancing first would have a resumed
 * run skip a phase whose writes never landed, and the run would finish reporting a
 * success nobody can see in the base.
 */
export async function advanceImportRun(
  write: ImportRunWrite,
  progress: ImportRunProgress,
  origin: WriteOrigin,
): Promise<void> {
  await patchRun(write, importRunProgressFields(progress), origin)
}

/**
 * End the run, released and either `done` or `failed`.
 *
 * The lease is cleared here (`importRunOutcomeFields`), which is what keeps a finished
 * run out of the sweep's lapsed-lease branch in `dueImportRuns`.
 */
export async function finishImportRun(
  write: ImportRunWrite,
  outcome: ImportRunOutcome,
  origin: WriteOrigin,
): Promise<void> {
  await patchRun(write, importRunOutcomeFields(outcome), origin)
}
