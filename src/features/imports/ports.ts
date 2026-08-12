// The vocabulary the run engine, its phases and the preview all share.
//
// A third file rather than a section of run.ts or phases.ts, for two reasons. The plain
// one is the 300-line ceiling this repo enforces. The one that decided the shape is
// `import/no-cycle`: run.ts calls the phases and the phases need the write ports and the
// ledger, so those cannot live in run.ts, and the preview needs the round-trip guard
// without pulling in a single phase. Everything here is a leaf that both sides import.
//
// It holds three things:
//
//   - `ImportWritePorts`, every local write an import makes, injected so a test drives
//     all four phases with fakes and never touches Airtable or the network.
//   - The ROUND-TRIP GUARD, which is what stops an Accelevents import re-importing bodo's
//     own pushes.
//   - The counts arithmetic, and the cast diff the additive participant write runs on.
//
// The MAPPING LEDGER moved to ledger.ts once it grew a write schedule of its own; it is
// still the thing that makes the import idempotent, and it imports from here.

import type { LookupKind } from '@/features/settings/lookups'
import type { IntegrationEntityType } from '@/services/accelevents/sync-types'
import type { RemoteIndex } from '@/services/airtable/reads-imports'
import type { ParticipantDraft, SpeakerDraft, SubmissionDraft } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'
import {
  EMPTY_IMPORT_COUNT,
  type ImportCount,
  type ImportCounts,
  type ImportEntityType,
  type ImportSource,
} from '@/types/imports'

/**
 * Stamped on `requestHash` for every mapping an IMPORT writes.
 *
 * That column exists for §5.7's push, which stores a hash of the payload it sent so a
 * retry can tell an already-accepted request from a new one. An import sends nothing, so
 * it has no such hash, and leaving the column blank would be indistinguishable from a
 * push row whose hash was never recorded.
 *
 * The distinction is load-bearing for exactly one thing, the round-trip guard: a mapping
 * row means either "bodo CREATED this remote record" (skip it on the way back in) or
 * "bodo IMPORTED this remote record" (update it on the way back in). Without a
 * discriminator the first Accelevents import would make every session it created look
 * like bodo's own write, and the second import would skip the entire event.
 */
export const IMPORT_REQUEST_HASH = 'imported'

/** A row destined for `IntegrationMappings`. `remoteId` arrives already namespaced. */
export type ImportMappingWrite = {
  /** Present when a row already exists for this entity, so it is patched not duplicated. */
  mappingId?: string
  eventId: RecordId
  entityType: IntegrationEntityType
  localId: RecordId
  remoteId: string
  requestHash: string
  syncedAt: string
}

/**
 * One of bodo's OWN speaker rows, reduced to what the Needs-email list needs.
 *
 * A read rather than a write, and it is here because it is vocabulary the engine, the
 * phases and the wiring all share. The list is a claim about bodo's records ("these people
 * cannot be sent a magic link"), so it has to be derived from bodo's records; deriving it
 * from the source made the run answer a different question. See `needsEmailFrom`.
 */
export type LocalSpeaker = {
  id: RecordId
  /** Already composed, so the derivation never has to know the column layout. */
  name: string
  email: string
}

/**
 * Every local write an import makes.
 *
 * Ports rather than direct DAL calls, for the reason the outbox drain gives: the
 * interleavings that matter here (a phase interrupted halfway, a second sweep arriving, a
 * re-run finding its own rows) can only be tested if the whole engine runs on fakes.
 *
 * `saveMappings` takes an ARRAY on purpose. It is the one write that happens once per
 * imported record, so a per-record call would double every phase's request count against
 * the ~5 req/s per-base cap (§3.1); handed a list, the Airtable client chunks it at 10,
 * which is that API's batch ceiling.
 */
export type ImportWritePorts = {
  createLookup: (draft: {
    kind: LookupKind
    eventId: RecordId
    name: string
    order?: number
  }) => Promise<RecordId>
  renameLookup: (change: {
    kind: LookupKind
    eventId: RecordId
    id: RecordId
    name: string
  }) => Promise<void>
  /**
   * For a speaker who HAS an address. Dedupes against a speaker bodo already holds, which
   * is what stops an import creating a second record for somebody who already has a portal.
   */
  upsertSpeakerByEmail: (draft: SpeakerDraft) => Promise<RecordId>
  /**
   * Unconditional create, and the ONLY path for a speaker with no address.
   *
   * Sessionize's public API has no email field, so those speakers land with `email: ''`.
   * Routing them through the upsert would match them all against each other on the empty
   * string and collapse a whole programme's cast onto one record. Nothing here ever
   * synthesises an address to avoid that: the run finishes owing a Needs-email list.
   */
  createSpeaker: (draft: SpeakerDraft) => Promise<RecordId>
  updateSpeaker: (update: {
    speakerId: RecordId
    eventId: RecordId
    draft: SpeakerDraft
  }) => Promise<void>
  createSubmission: (input: {
    draft: SubmissionDraft
    participants: readonly ParticipantDraft[]
  }) => Promise<RecordId>
  /**
   * Body only, and the answer blob is NOT part of it.
   *
   * The typed columns and the title are the import's; `answersJson` is the speaker's. The
   * DAL's own `updateSubmission` REPLACES that blob, so an adapter that passed `{}` here
   * (both of them did) wiped the answers of any imported submission a speaker had since
   * edited through the portal, on the next re-import. The cast is `addParticipants`.
   */
  updateSubmission: (change: {
    submissionId: RecordId
    eventId: RecordId
    title: string
    format?: string
    level?: string
    language?: string
    trackId?: RecordId
    tagIds?: readonly RecordId[]
  }) => Promise<void>
  /**
   * The cast of a submission that already exists, ADDITIVELY. Answers with how many rows
   * it wrote.
   *
   * Takes the whole cast the source now names and writes rows only for the speakers that
   * have none, because §5.0e is explicit that a re-run "updates what it created before and
   * creates what is new; it never deletes". So a speaker added to a remote session between
   * two imports lands, and one REMOVED from it keeps their row: bodo cannot tell that apart
   * from an organizer adding a co-presenter by hand, and deleting somebody's participation
   * on a guess is the worse of the two mistakes. Before this port the update branch skipped
   * the cast entirely, so a session that gained a speaker kept its old roster forever.
   */
  addParticipants: (change: {
    submissionId: RecordId
    eventId: RecordId
    participants: readonly ParticipantDraft[]
  }) => Promise<number>
  scheduleSubmission: (change: {
    submissionId: RecordId
    eventId: RecordId
    roomId?: RecordId
    startsAt?: string
    endsAt?: string
  }) => Promise<void>
  saveMappings: (writes: readonly ImportMappingWrite[]) => Promise<void>
}

/**
 * The remote ids `IntegrationMappings` says bodo AUTHORED, bare and unprefixed.
 *
 * Only ever non-empty for Accelevents, because that is the only provider bodo pushes to.
 * A push row is one whose `requestHash` is not this import's sentinel. Rows a previous
 * import wrote are deliberately NOT in here, or a re-import would skip everything it had
 * already brought in and report an empty run.
 */
export function authoredRemoteIds(index: RemoteIndex, source: ImportSource): ReadonlySet<string> {
  const authored = new Set<string>()
  if (source !== 'accelevents') return authored
  const prefix = `${source}:`
  for (const [key, mapping] of index) {
    if (mapping.requestHash === IMPORT_REQUEST_HASH) continue
    authored.add(key.startsWith(prefix) ? key.slice(prefix.length) : key)
  }
  return authored
}

/**
 * The half of a cast that has no `SubmissionParticipants` row yet.
 *
 * Pure and here rather than inside the adapter, so the one rule that matters is unit
 * tested: matching is on SPEAKER, not on role or order. A co-presenter promoted to primary
 * on the far side already has a row, and writing a second one would double them on the
 * agenda; the roster diverging by a role is the smaller error, and §5.0e's "never deletes"
 * leaves no way to correct it in place anyway.
 */
export function missingCast(
  existingSpeakerIds: Iterable<string>,
  desired: readonly ParticipantDraft[],
): readonly ParticipantDraft[] {
  const held = new Set(existingSpeakerIds)
  return desired.filter((member) => {
    if (held.has(member.speakerId)) return false
    // Added as it goes, so a source that names the same speaker twice on one session
    // produces one row rather than two.
    held.add(member.speakerId)
    return true
  })
}

export function importCount(created: number, updated: number, skipped = 0): ImportCount {
  return { created, updated, skipped }
}

/**
 * Cumulative for the run, because the row stores totals rather than per-phase deltas.
 *
 * Built through a Map rather than by indexing the object, so a runtime entity name can
 * never reach a property assignment (`security/detect-object-injection`).
 */
export function mergeCounts(base: ImportCounts, delta: ImportCounts): ImportCounts {
  const entries = (counts: ImportCounts): readonly [ImportEntityType, ImportCount][] =>
    Object.entries(counts) as [ImportEntityType, ImportCount][]
  const merged = new Map<ImportEntityType, ImportCount>(entries(base))

  for (const [entity, value] of entries(delta)) {
    const held = merged.get(entity) ?? EMPTY_IMPORT_COUNT
    merged.set(entity, {
      created: held.created + value.created,
      updated: held.updated + value.updated,
      skipped: held.skipped + value.skipped,
    })
  }
  return Object.fromEntries(merged)
}
