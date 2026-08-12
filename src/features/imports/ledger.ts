// The MAPPING LEDGER: what makes an import idempotent, and what makes it resumable.
//
// Remote id to local record, indexed once for the whole event rather than looked up per
// row, and the opposite direction from `IntegrationMappings`' own (event, entityType,
// localId) uniqueness. A hit is an UPDATE, a miss is a CREATE, nothing is ever deleted.
//
// Split out of ports.ts for the 300-line ceiling, along the seam that file already
// described: ports.ts is the vocabulary the engine, the phases and the preview share, and
// this is the one piece of it with state and a write schedule. It imports the write ports
// rather than the other way round, so there is no cycle.

import {
  IMPORT_REQUEST_HASH,
  type ImportMappingWrite,
  type ImportWritePorts,
} from '@/features/imports/ports'
import type { IntegrationEntityType, IntegrationMapping } from '@/services/accelevents/sync-types'
import type { RemoteIndex } from '@/services/airtable/reads-imports'
import { findRemoteMapping, remoteKey } from '@/services/airtable/reads-imports'
import type { RecordId } from '@/types/domain'
import type { ImportSource } from '@/types/imports'

/**
 * Airtable's create/update batch ceiling (§3.1), and therefore the buffer's ceiling too.
 *
 * The unit is not arbitrary and it is not a tuning knob: a flush of ten rows is exactly one
 * request, so buffering to ten costs one request either way and buffering past it costs a
 * record whose mapping is only in an isolate's memory. It applies to ONE entity class now,
 * the one that can afford the window: see `MappingDedupe`.
 */
export const MAPPING_BATCH = 10

/**
 * Whether the entity a mapping points at can be found again WITHOUT the mapping.
 *
 * This is the only thing that decides when the buffer is written, because it is the only
 * thing that decides what a lost mapping COSTS.
 *
 * `natural-key`: the write that lands the record matches on a column before it creates, so
 * a resumed run finds the same record again. A lost mapping costs one extra lookup and
 * nothing else. Exactly one entity class is in here, a speaker WITH an address, which goes
 * through `upsertSpeakerByEmail` and matches on the email column.
 *
 * `none`: the write is an unconditional create, so a lost mapping is a DUPLICATE ROW.
 * Airtable has no uniqueness constraint that would have caught it and nothing later in the
 * import notices. Everything else an import creates is in this class:
 *
 *   - rooms, tracks and tags: `createLookup` creates unconditionally, so a lost mapping is
 *     a second track carrying the same name as the first;
 *   - a speaker with NO address, which is every Sessionize speaker because that API has no
 *     email field at all: `createSpeaker` is the only path open to them (see
 *     `ImportWritePorts`) and it has nothing to match on;
 *   - submissions: `createSubmission` creates unconditionally too.
 */
export type MappingDedupe = 'natural-key' | 'none'

/** Remote id to local record, for one run, kept current as the run creates things. */
export type MappingLedger = {
  localIdFor: (entityType: IntegrationEntityType, remoteId: string) => RecordId | undefined
  /**
   * Records a mapping row. Writes it IMMEDIATELY when the entity has no natural key,
   * buffers it to `MAPPING_BATCH` when it has one.
   *
   * Async for that reason. Two rounds of this are worth stating, because the second one
   * only bounded what the first had failed to cure:
   *
   *   1. It buffered a whole PHASE and wrote at `flush()`, so a phase interrupted anywhere
   *      before its last line left every record it had created unmapped and the resumed
   *      run created all of them a second time.
   *   2. It then wrote at every tenth pending row, which left records 1 to 10 safe and
   *      record 11 exposed. Nine duplicate rows instead of a phase's worth is a smaller
   *      bug, not a different one.
   *
   * `dedupe` is what closes it for the classes that can actually duplicate.
   */
  record: (
    entityType: IntegrationEntityType,
    remoteId: string,
    localId: RecordId,
    dedupe: MappingDedupe,
  ) => Promise<void>
  flush: () => Promise<void>
}

export type LedgerInput = {
  index: RemoteIndex
  source: ImportSource
  eventId: RecordId
  /** One instant for the whole run, so a phase boundary is not a clock read. */
  now: string
  save: ImportWritePorts['saveMappings']
}

export function createLedger(input: LedgerInput): MappingLedger {
  // Everything the run has created this invocation, ahead of the index. A later phase
  // resolves a track the metadata phase just made without re-reading the whole table.
  const fresh = new Map<string, RecordId>()
  let pending: ImportMappingWrite[] = []
  const key = (entityType: IntegrationEntityType, remoteId: string): string =>
    `${entityType} ${remoteId}`

  const found = (
    entityType: IntegrationEntityType,
    remoteId: string,
  ): IntegrationMapping | undefined =>
    findRemoteMapping(input.index, input.source, remoteId, entityType)

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return
    const batch = pending
    // Cleared BEFORE the await, so a failed flush cannot be replayed by a later call
    // and write every row twice. The phase throws, the run records a failure, and the
    // records that did land are found by the next run's index instead.
    pending = []
    await input.save(batch)
  }

  return {
    localIdFor: (entityType, remoteId) =>
      fresh.get(key(entityType, remoteId)) ?? found(entityType, remoteId)?.localId,

    record: async (entityType, remoteId, localId, dedupe) => {
      fresh.set(key(entityType, remoteId), localId)
      pending.push({
        // Reuses an existing row when one is somehow already there, so a mapping whose
        // local record was replaced is repointed rather than duplicated.
        mappingId: found(entityType, remoteId)?.id,
        eventId: input.eventId,
        entityType,
        localId,
        remoteId: remoteKey(input.source, remoteId),
        requestHash: IMPORT_REQUEST_HASH,
        syncedAt: input.now,
      })
      // THE COST, stated rather than assumed, against §3.1's ~5 requests per second per
      // base. A flush is one request whether it carries one row or ten, so an immediate
      // flush adds exactly one request per record created:
      //
      //   lookups        1 request each (`createLookup`)        -> 2
      //   addressless    1 request each (`createSpeaker`)       -> 2
      //   submissions    1 request each (`createSubmission`)    -> 2
      //   with an email  2 requests each (`upsertSpeakerByEmail`
      //                  reads the email column, then writes)   -> 2.1, batched
      //
      // So 500 sessions go from ~550 requests in the submissions phase to ~1000, which at
      // that cap is roughly 110s of scheduler time becoming 200s. That is bought knowingly:
      // a phase is one invocation and a run that hits a limit mid-phase RESUMES, so the
      // price is duration, and the thing it buys back is the only failure in this engine
      // that a resume cannot repair. The one class that keeps the batch is the one where
      // batching is both safe and worth most: a hundred addressed speakers stay at ~210
      // requests instead of ~300.
      //
      // A BOUND, NOT A CURE, and this is the sentence the previous round should have had.
      // The record is written before its mapping and nothing here changes that: an isolate
      // killed between the create and the flush on the very next line, or a flush that
      // itself fails, still leaves one unmapped record. The window is now ONE record wide
      // for the classes that can duplicate, and closing it entirely needs a compare-and-swap
      // across two Airtable tables, which Airtable does not have.
      if (dedupe === 'none' || pending.length >= MAPPING_BATCH) await flush()
    },

    flush,
  }
}
