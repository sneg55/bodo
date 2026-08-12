// The phase vocabulary, plus the first two phases. The writes an import makes. §5.0e.
//
// Split from run.ts because the two halves change for different reasons: run.ts owns the
// claim, the resume point and the outcome, and this file owns what each phase writes.
// The ports, the ledger and the counts arithmetic they share are in ports.ts, and the
// submissions and agenda phases are in phases-content.ts, which is the 300-line ceiling
// rather than a second idea: `PhaseContext` and the order below still govern both.
//
// DEPENDENCY ORDER IS THE DESIGN, and `IMPORT_PHASES` is that order: metadata (rooms,
// tracks, tags), then speakers, then submissions, then agenda placement. A submission
// cannot link a track that does not exist yet, and a placement cannot move a submission
// that has not been created yet. This is §5.7's push order in reverse, which is not a
// coincidence: both walks are constrained by the same link graph.
//
// IDEMPOTENCY IS THE LEDGER. Every write is preceded by a lookup that goes from remote id
// to local record, the opposite direction from `IntegrationMappings`' own (event,
// entityType, localId) uniqueness, so the event's rows are read once and indexed rather
// than looked up per row. A hit is an UPDATE, a miss is a CREATE, nothing is ever deleted.
// A wall of creates on a second run means the key stopped matching.
//
// Each phase flushes its remaining mapping rows BEFORE it returns, and run.ts records
// progress only after that. A phase whose records landed but whose mappings did not would
// have the next run create every one of them again, which is why the ledger does not wait
// for the phase to end either: it writes a mapping the instant the record it points at has
// no other way of being found again. `MappingDedupe` in ledger.ts is that rule.
//
// THE PER-ENTITY WRITE CEILING, stated rather than hidden. Every lookup, speaker,
// submission and placement is one Airtable request of its own, and `upsertSpeakerByEmail`
// is TWO (it reads the email column before it writes), because none of those DAL functions
// takes a list and each needs the record id it returns. On top of that, everything with no
// natural key costs one more for its mapping row. At §3.1's ~5 requests per second per base
// that is the arithmetic:
//
//   100 addressed speakers   ~210 requests  ~42s of scheduler time in one phase
//   100 addressless speakers ~200 requests  ~40s
//   500 sessions             ~1000 requests ~200s, plus ~100s for the agenda phase
//
// A phase is one Worker invocation (`maxPhases: 1`), so the number to watch is a single
// phase's, not the run's. Under a few hundred entities per phase this is comfortable.
// Past roughly 500 it is not, and the fix is a batched DAL write that returns ids in
// order, not more concurrency here: two phases racing the same base spend the budget on
// each other's 429s. A run that hits a limit mid-phase resumes, so this is a duration
// problem rather than a correctness one.

import type { MappingLedger } from '@/features/imports/ledger'
import type {
  NormalizedImport,
  NormalizedRef,
  NormalizedSpeaker,
} from '@/features/imports/normalize'
import { type ImportWritePorts, importCount, type LocalSpeaker } from '@/features/imports/ports'
import type { LookupKind } from '@/features/settings/lookups'
import type { SpeakerDraft } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'
import {
  IMPORT_PHASES,
  type ImportCount,
  type ImportCounts,
  type ImportPhase,
  type ImportSource,
  type NeedsEmailRow,
} from '@/types/imports'

export type PhaseContext = {
  eventId: RecordId
  source: ImportSource
  normalized: NormalizedImport
  ledger: MappingLedger
  write: ImportWritePorts
  /**
   * bodo's own speaker rows for this event, read UNCACHED. Bound by run.ts, and the only
   * READ a phase makes. `needsEmailFrom` is its one caller and carries the reason.
   */
  readSpeakers: () => Promise<readonly LocalSpeaker[]>
}

/**
 * `counts` and nothing else, deliberately.
 *
 * It used to carry the Needs-email list as well, produced by the speakers phase. run.ts
 * then rebuilt that list at outcome time anyway, so the phase's copy was overwritten in
 * every case and paid for a second full read of the Speakers table on the one invocation
 * that can least afford it (§3.1). One producer, at the outcome, is the rule now.
 */
export type PhaseOutcome = {
  counts: ImportCounts
}

/**
 * The phases still to do, given what the row says.
 *
 * `ImportRun.phase` is read as THE PHASE ABOUT TO BE WORKED ON, never as the one just
 * finished, and every write of it keeps that meaning. A fresh row is created at
 * `metadata`, which is exactly right under that reading, and it is the reading that makes
 * resumption a slice rather than an off-by-one.
 */
export function remainingPhases(from: ImportPhase): readonly ImportPhase[] {
  const at = IMPORT_PHASES.indexOf(from)
  return at === -1 ? IMPORT_PHASES : IMPORT_PHASES.slice(at)
}

export function nextPhase(phase: ImportPhase): ImportPhase {
  // The last phase stays put. There is no "finished" phase value, and sending the row
  // back to `metadata` would have a resumed run redo the entire import.
  return IMPORT_PHASES[IMPORT_PHASES.indexOf(phase) + 1] ?? phase
}

/** Rooms, tracks and tags. Everything a submission links to, before any submission. */
export async function runMetadataPhase(ctx: PhaseContext): Promise<PhaseOutcome> {
  const room = await syncRefs(ctx, 'room', ctx.normalized.rooms)
  const track = await syncRefs(ctx, 'track', ctx.normalized.tracks)
  const tag = await syncRefs(ctx, 'tag', ctx.normalized.tags)
  await ctx.ledger.flush()
  return { counts: { room, track, tag } }
}

/**
 * `LookupKind` and the three metadata entity types are the same three strings, so the
 * kind is the entity type rather than a table mapping that could drift out of step.
 */
async function syncRefs(
  ctx: PhaseContext,
  kind: LookupKind,
  refs: readonly NormalizedRef[],
): Promise<ImportCount> {
  let created = 0
  let updated = 0

  for (const ref of refs) {
    // A blank name is dropped rather than created: an unnamed track is a row nobody can
    // pick in a filter, and renaming a real one to nothing would lose the name it had.
    if (ref.name.trim() === '') continue

    const held = ctx.ledger.localIdFor(kind, ref.remoteId)
    if (held !== undefined) {
      await ctx.write.renameLookup({ kind, eventId: ctx.eventId, id: held, name: ref.name })
      updated += 1
      continue
    }

    const id = await ctx.write.createLookup({
      kind,
      eventId: ctx.eventId,
      name: ref.name,
      order: ref.order,
    })
    // `none`: `createLookup` creates unconditionally, so a mapping lost between here and
    // the next invocation is a second track, room or tag carrying the same name.
    await ctx.ledger.record(kind, ref.remoteId, id, 'none')
    created += 1
  }
  return importCount(created, updated)
}

function speakerDraft(speaker: NormalizedSpeaker, eventId: RecordId): SpeakerDraft {
  const { remoteId: _remoteId, ...rest } = speaker
  // The DAL merges the event link rather than replacing it, so a speaker who already
  // belongs to another event keeps that membership.
  return { ...rest, eventIds: [eventId] }
}

/**
 * Speakers, and the Needs-email list.
 *
 * The list covers every speaker the phase touched, created or updated, not only the ones
 * it created: a Sessionize re-run updates the speakers it made last time and those still
 * have no address, so dropping them would make the second run look like it had solved a
 * problem it had not. What decides membership is bodo's own row, not the payload, and
 * `needsEmailFrom` carries that argument.
 */
export async function runSpeakersPhase(ctx: PhaseContext): Promise<PhaseOutcome> {
  let created = 0
  let updated = 0

  for (const speaker of ctx.normalized.speakers) {
    const draft = speakerDraft(speaker, ctx.eventId)
    const held = ctx.ledger.localIdFor('speaker', speaker.remoteId)

    if (held !== undefined) {
      await ctx.write.updateSpeaker({ speakerId: held, eventId: ctx.eventId, draft })
      updated += 1
      continue
    }

    // The empty address is what splits the two creates, and it is the whole reason
    // `createSpeaker` exists as a port of its own. See `ImportWritePorts`.
    const addressless = speaker.email === ''
    const id = addressless
      ? await ctx.write.createSpeaker(draft)
      : await ctx.write.upsertSpeakerByEmail(draft)
    // The SAME condition decides the mapping's write schedule, because it is the same
    // fact: an addressed speaker is re-found by `upsertSpeakerByEmail` on the email column
    // if the mapping is lost, and an addressless one has no key at all, so their mapping is
    // the only thing standing between an interruption and a duplicate row.
    await ctx.ledger.record('speaker', speaker.remoteId, id, addressless ? 'none' : 'natural-key')
    created += 1
  }

  await ctx.ledger.flush()
  return { counts: { speaker: importCount(created, updated, ctx.normalized.skipped.speakers) } }
}

/**
 * The Needs-email list, read off bodo's OWN speaker rows.
 *
 * Derivable by a caller that did not run the speakers phase, which is the point:
 * `ImportRunProgress` persists the phase and the counts and nothing else, so a run split
 * across invocations (which `maxPhases: 1` makes every real one) used to reload an empty
 * list and finish reporting that nobody needed an address. run.ts therefore rebuilds it at
 * outcome time, on the success path and the failure path alike.
 *
 * IT IS NOT DERIVED FROM THE SOURCE, and that was the second defect in the same list. The
 * far side is re-read every invocation, so a run whose speakers phase imported Ada without
 * an address, and whose source then GAINED one for her before the invocation that finished
 * the run, reported an empty list while Ada's local row still had no address and still
 * could not be sent a magic link. `normalized.needsEmail` answers "who is addressless
 * upstream, right now"; the organizer is owed the answer to "who in bodo cannot be
 * contacted", and only the local rows can give it. It is also the answer that survives a
 * re-run, where the source may have moved on considerably.
 *
 * TWO BOUNDS, both from the fact that the run has to name the remote id it is reporting:
 * a speaker the source has since DROPPED is not in this list even if their local row is
 * still addressless, and neither is one an earlier RUN created, because the walk is over
 * the speakers this run's source names. The ledger supplies the local id for both halves
 * of what is in scope: speakers this invocation created, and speakers an earlier
 * invocation of the same run created and mapped.
 */
export async function needsEmailFrom(ctx: PhaseContext): Promise<readonly NeedsEmailRow[]> {
  const local = new Map<RecordId, LocalSpeaker>()
  for (const speaker of await ctx.readSpeakers()) local.set(speaker.id, speaker)

  const rows: NeedsEmailRow[] = []
  for (const speaker of ctx.normalized.speakers) {
    const speakerId = ctx.ledger.localIdFor('speaker', speaker.remoteId)
    if (speakerId === undefined) continue
    const held = local.get(speakerId)
    // Absent means the row could not be read back, and claiming it has no address would be
    // a guess. Present with an address means somebody, upstream or an organizer here,
    // has since supplied one and the debt is settled.
    if (held === undefined || held.email.trim() !== '') continue
    rows.push({
      speakerId,
      name: held.name === '' ? sourceName(speaker) : held.name,
      remoteId: speaker.remoteId,
    })
  }
  return rows
}

/** Only reached when bodo holds no name either, so there is nothing better to show. */
function sourceName(speaker: NormalizedSpeaker): string {
  return `${speaker.firstName} ${speaker.lastName}`.trim()
}
