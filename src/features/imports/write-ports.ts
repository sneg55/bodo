// Every local write an import makes, bound to the real DAL. One set, both callers.
//
// It used to be two: a `writePorts` const in `/api/cron/imports/route.ts` and a
// byte-for-byte copy in run-wiring.ts, differing only in the `WriteOrigin` each passed.
// The copy carried its own comment saying the two must stay identical, which is the
// argument for this file rather than against it: the same run is advanced one phase at a
// time by EITHER caller, so two sets that disagreed about what a write means would make
// the outcome depend on which one happened to pick the row up. Three of the defects this
// file was written to fix (the wiped answer blob, the cast that was never updated, the
// mapping write that invalidated nothing) existed twice for exactly that reason.
//
// A FACTORY, not a const, and both reasons matter. It takes the origin, which
// `invalidate` needs and which no default can supply honestly. And it closes over one
// invocation's worth of state: the cast reader below memoises a table read, and a
// module-level cache in a Worker isolate outlives the request that filled it.

import { AppError, ErrorIds } from '@/constants/errorIds'
import {
  type ImportMappingWrite,
  type ImportWritePorts,
  type LocalSpeaker,
  missingCast,
} from '@/features/imports/ports'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { mapParticipant, mapSpeaker, speakerEventIds } from '@/services/airtable/mapping'
import { createSubmission, scheduleSubmission } from '@/services/airtable/mutations'
import { createLookup, renameLookup } from '@/services/airtable/mutations-lookups'
import { saveSpeakerProfile, upsertSpeakerByEmail } from '@/services/airtable/mutations-speakers'
import { COL, TABLES } from '@/services/airtable/tables'
import {
  eventAgendaTag,
  eventIntegrationsTag,
  eventSpeakersTag,
  eventSubmissionsTag,
  speakerTag,
  submissionTag,
} from '@/services/airtable/tags'
import { compact, link, participantFields, speakerFields } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'

type SubmissionBody = Parameters<ImportWritePorts['updateSubmission']>[0]
type CastChange = Parameters<ImportWritePorts['addParticipants']>[0]

export function importWritePorts(origin: WriteOrigin): ImportWritePorts {
  const heldCast = castReader()
  return {
    createLookup: async (draft) => await createLookup(draft, origin),
    renameLookup: async (change) => {
      await renameLookup(change, origin)
    },
    upsertSpeakerByEmail: async (draft) => (await upsertSpeakerByEmail(draft, origin)).id,
    createSpeaker: async (draft) => await createSpeaker(draft, origin),
    updateSpeaker: async (update) => {
      await saveSpeakerProfile(update, origin)
    },
    createSubmission: async (input) => (await createSubmission(input, origin)).id,
    updateSubmission: async (change) => {
      await updateSubmissionBody(change, origin)
    },
    addParticipants: async (change) => await addParticipants(change, heldCast, origin),
    scheduleSubmission: async (change) => {
      await scheduleSubmission({ ...change, scheduleStatus: 'scheduled' }, origin)
    },
    saveMappings: async (writes) => {
      await saveMappings(writes, origin)
    },
  }
}

/**
 * bodo's own speaker rows for one event, UNCACHED. The Needs-email list's only source.
 *
 * Uncached for `castReader`'s reason and it is the stronger case here: the run has just
 * written into this table, and the list this feeds is a claim the organizer acts on
 * ("these people cannot be sent a magic link"). A cached read would answer for the state
 * before the import. `listSpeakers` is the cached counterpart and is deliberately not what
 * this calls.
 *
 * Scoped through the `events` link rather than a formula, because a speaker belongs to
 * many events, which is the same reason `listSpeakers` cannot go through `listByEvent`.
 * One paginated list per call, and it is called once per invocation at outcome time.
 */
export async function readEventSpeakers(eventId: RecordId): Promise<readonly LocalSpeaker[]> {
  const records = await getClient().listAll(TABLES.speakers)
  return records
    .filter((record) => speakerEventIds(record).includes(eventId))
    .map(mapSpeaker)
    .map((speaker) => ({
      id: speaker.id,
      name: `${speaker.firstName} ${speaker.lastName}`.trim(),
      email: speaker.email,
    }))
}

/**
 * An unconditional speaker create, the one path a speaker with no address can take.
 *
 * `upsertSpeakerByEmail` cannot serve it: it matches on the email column, and an empty
 * string matches every other addressless speaker, so a whole Sessionize cast would
 * collapse onto one record. Nothing here invents an address to make that go away. The run
 * finishes owing the organizer a Needs-email list instead.
 *
 * Written here rather than in `mutations.ts` only because the change that added it did not
 * own that file. It belongs beside `upsertSpeakerByEmail`, and moving it there is a rename.
 */
async function createSpeaker(
  draft: Parameters<ImportWritePorts['createSpeaker']>[0],
  origin: WriteOrigin,
): Promise<RecordId> {
  const created = (await getClient().createRecords(TABLES.speakers, [speakerFields(draft)])).at(0)
  if (created === undefined) {
    // The row's identity is unknown and every later phase needs it, so failing here is
    // recoverable where returning a made-up id would map a mapping row onto nothing.
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'Speakers create returned no record', {})
  }
  invalidate(origin, {
    own: [speakerTag(created.id), ...(draft.eventIds ?? []).map(eventSpeakersTag)],
  })
  return created.id
}

/**
 * The typed columns and the title. NEVER `answersJson`.
 *
 * Not the DAL's `updateSubmission`, and that is the fix rather than a shortcut: its
 * `SubmissionEdit` requires `answers` and REPLACES the blob with whatever it is handed.
 * Both import adapters passed `{}`, so every re-import erased the answers a speaker had
 * edited through the portal on a submission the first import created. An import has no
 * answers to write, and "no answers" has to mean "do not touch the column", not "empty".
 *
 * The tags this expires are the DAL function's, kept in step deliberately: the same three
 * screens go stale whichever of the two writes the row.
 */
async function updateSubmissionBody(change: SubmissionBody, origin: WriteOrigin): Promise<void> {
  await getClient().updateRecords(TABLES.submissions, [
    {
      id: change.submissionId,
      fields: compact({
        [COL.title]: change.title,
        [COL.format]: change.format,
        [COL.level]: change.level,
        [COL.language]: change.language,
        [COL.track]: change.trackId === undefined ? undefined : link(change.trackId),
        [COL.tags]: change.tagIds,
      }),
    },
  ])

  invalidate(origin, {
    own: [eventSubmissionsTag(change.eventId), submissionTag(change.submissionId)],
    // The agenda card shows the title and the track, so a retitled session changes a
    // screen nobody is looking at while the import runs.
    others: [eventAgendaTag(change.eventId)],
  })
}

/**
 * Cast rows for the people a remote session now names who have none. Additive, per §5.0e.
 *
 * The update branch of the submissions phase used to write no participants at all, so a
 * session that gained a co-speaker upstream kept its original roster through every later
 * import. What it does NOT do is delete: a speaker dropped on the far side is
 * indistinguishable from one an organizer added here by hand, and `missingCast` carries
 * the rest of that argument.
 */
async function addParticipants(
  change: CastChange,
  heldCast: CastReader,
  origin: WriteOrigin,
): Promise<number> {
  const held = await heldCast(change.submissionId)
  const missing = missingCast(held, change.participants)
  if (missing.length === 0) return 0

  await getClient().createRecords(
    TABLES.submissionParticipants,
    missing.map((member) => participantFields(member, change.submissionId)),
  )
  // Recorded so a second call for the same submission in this run (a source that lists a
  // session twice) does not write the same rows again off a stale read.
  for (const member of missing) held.add(member.speakerId)

  invalidate(origin, {
    own: [submissionTag(change.submissionId), eventSubmissionsTag(change.eventId)],
    others: [eventAgendaTag(change.eventId), eventSpeakersTag(change.eventId)],
  })
  return missing.length
}

type CastReader = (submissionId: RecordId) => Promise<Set<string>>

/**
 * Who is already on each submission, read ONCE per invocation and UNCACHED.
 *
 * Uncached because the answer decides a write, and a cached roster is a duplicate
 * participant row. Once, because the read has no per-submission form
 * (`SubmissionParticipants` is only listable whole) and a phase that called it per row
 * would spend the whole ~5 req/s budget (§3.1) on reads. One paginated list per invocation
 * is the same cost `loadRemoteIndex` already pays.
 *
 * WHAT IT DOES NOT PROTECT AGAINST, said plainly because the memoisation reads like it
 * might. The set is an invocation-wide SNAPSHOT plus whatever this invocation has written
 * since, so a second writer adding a co-presenter through the admin UI while an import is
 * running can still produce a duplicate row: this reader took its list before that write
 * landed. Airtable has no uniqueness constraint and no compare-and-swap to close it, and a
 * writer racing an import is not a case this codebase defends anywhere else. Accepted, not
 * handled.
 */
function castReader(): CastReader {
  let loaded: Promise<Map<RecordId, Set<string>>> | undefined
  const readAll = async (): Promise<Map<RecordId, Set<string>>> => {
    const rows = await getClient().listAll(TABLES.submissionParticipants)
    const bySubmission = new Map<RecordId, Set<string>>()
    for (const record of rows.map(mapParticipant)) {
      const held = bySubmission.get(record.submissionId) ?? new Set<string>()
      held.add(record.speakerId)
      bySubmission.set(record.submissionId, held)
    }
    return bySubmission
  }

  return async (submissionId) => {
    loaded ??= readAll()
    const bySubmission = await loaded
    const held = bySubmission.get(submissionId) ?? new Set<string>()
    bySubmission.set(submissionId, held)
    return held
  }
}

/**
 * `IntegrationMappings` rows, batched, and the tag they affect expired.
 *
 * NOT `saveIntegrationMapping`, and that is the whole point of a separate writer: that one
 * is the Accelevents PUSH's, so it forces an `accelevents:` prefix onto every remote id it
 * is handed. An import's ids are already namespaced by their own source, and running them
 * through it would store `accelevents:sessionize:14022`, which nothing would ever find
 * again. It also types `entityType` as the push's four values, and an import maps rooms.
 *
 * Creates and updates are separated so each side reaches the client as one list, which it
 * then chunks at 10, Airtable's batch ceiling (§3.1). A per-row call here would double the
 * request count of every phase.
 *
 * The `invalidate` is not decoration. `eventIntegrationsTag` covers `IntegrationMappings`,
 * `SyncLog` and `ImportRuns` together, and this used to return without expiring it: a run
 * that committed its mappings and was then interrupted before its progress write left the
 * Integrations page serving the mapping list from before the import.
 */
async function saveMappings(
  writes: readonly ImportMappingWrite[],
  origin: WriteOrigin,
): Promise<void> {
  const fieldsOf = (write: ImportMappingWrite) => ({
    [COL.event]: [write.eventId],
    [COL.entityType]: write.entityType,
    [COL.localId]: write.localId,
    [COL.remoteId]: write.remoteId,
    [COL.requestHash]: write.requestHash,
    [COL.syncedAt]: write.syncedAt,
  })

  const fresh = writes.filter((write) => write.mappingId === undefined)
  const held = writes.filter((write) => write.mappingId !== undefined)

  if (fresh.length > 0) {
    await getClient().createRecords(TABLES.integrationMappings, fresh.map(fieldsOf))
  }
  if (held.length > 0) {
    await getClient().updateRecords(
      TABLES.integrationMappings,
      held.map((write) => ({ id: write.mappingId ?? '', fields: fieldsOf(write) })),
    )
  }

  // Every write in one flush belongs to one event, but the tag is derived per row rather
  // than from the first one: nothing in the type says so, and a Set costs nothing.
  const events = new Set(writes.map((write) => write.eventId))
  invalidate(origin, { own: [...events].map(eventIntegrationsTag) })
}
