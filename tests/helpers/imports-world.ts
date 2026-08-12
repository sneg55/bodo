// A whole fake world for the import engine: run rows, mapping rows, and every write port.
//
// Shared by the three import tests the way `outbox-drain.ts` is shared by the drain's,
// and for the same reason: the properties worth testing are all about interleaving (a run
// that died mid-way, a second run over the same data, two sweeps arriving at once), and
// none of them is observable unless the engine can be stepped without a network.
//
// `calls` is an ordered log rather than a set of spies, because DEPENDENCY ORDER is one of
// the things under test: prerequisites first, then speakers, then submissions, then the
// placement. An unordered assertion would pass on a walk that cannot actually work.

import type { NormalizedImport } from '@/features/imports/normalize'
import {
  type ImportMappingWrite,
  type ImportWritePorts,
  type LocalSpeaker,
  missingCast,
} from '@/features/imports/ports'
import type { ImportRunDeps } from '@/features/imports/run'
import type { IntegrationMapping } from '@/services/accelevents/sync-types'
import type { RemoteIndex } from '@/services/airtable/reads-imports'
import type { ImportRunOutcome } from '@/services/airtable/to-fields-imports'
import { EMPTY_IMPORT_MAPPING, type ImportRun } from '@/types/imports'

export const NORMALIZED: NormalizedImport = {
  source: 'sessionize',
  rooms: [{ remoteId: 'r1', name: 'Hall A', order: 1 }],
  tracks: [{ remoteId: 't1', name: 'AI' }],
  tags: [{ remoteId: 'g1', name: 'Beginner' }],
  speakers: [
    // No address, because Sessionize's public API has no email field. This one may only
    // ever reach `createSpeaker`, never the upsert.
    { remoteId: 's1', email: '', firstName: 'Ada', lastName: 'Lovelace', links: {} },
    { remoteId: 's2', email: 'grace@example.com', firstName: 'Grace', lastName: 'H', links: {} },
  ],
  submissions: [
    {
      remoteId: 'x1',
      title: 'Talk one',
      status: 'accepted',
      reviewRequired: false,
      trackRemoteId: 't1',
      tagRemoteIds: ['g1'],
      roomRemoteId: 'r1',
      startsAt: '2026-09-01T09:00:00.000Z',
      endsAt: '2026-09-01T10:00:00.000Z',
      participants: [
        { speakerRemoteId: 's1', role: 'speaker', isPrimary: true, sortOrder: 0 },
        { speakerRemoteId: 's2', role: 'co_speaker', isPrimary: false, sortOrder: 1 },
      ],
    },
  ],
  // Agenda furniture with no speaker behind it. bodo has no row for that, so it has to be
  // counted as skipped rather than dropped in silence.
  agendaItems: [{ remoteId: 'lunch', title: 'Lunch' }],
  needsEmail: [{ name: 'Ada Lovelace', remoteId: 's1' }],
  skipped: { speakers: 0, submissions: 0 },
  warnings: [],
}

/**
 * The same programme as an Accelevents pull.
 *
 * No taxonomy lists and no speaker list, because that source documents no endpoint that
 * reads them back, and no service sessions, because only Sessionize marks them. What is
 * left is one submission, which is exactly what the round-trip guard has to act on.
 */
export function acceleventsPayload(): NormalizedImport {
  return {
    ...NORMALIZED,
    source: 'accelevents',
    rooms: [],
    tracks: [],
    tags: [],
    speakers: [],
    agendaItems: [],
  }
}

export type World = {
  runs: Map<string, ImportRun>
  mappings: ImportMappingWrite[]
  /** Speaker ids per submission, the way `SubmissionParticipants` rows read back. */
  cast: Map<string, string[]>
  /**
   * bodo's OWN speaker rows, which is what the Needs-email list is read off.
   *
   * Held rather than derived from the payload, because the defect this models is exactly
   * the difference between the two: the source can gain an address for somebody the run
   * already imported without one, and the local row does not change when it does.
   */
  speakers: Map<string, LocalSpeaker>
  calls: string[]
  outcomes: ImportRunOutcome[]
  nextId: number
}

export function newWorld(): World {
  return {
    runs: new Map(),
    mappings: [],
    cast: new Map(),
    speakers: new Map(),
    calls: [],
    outcomes: [],
    nextId: 0,
  }
}

export function queuedRun(world: World, overrides: Partial<ImportRun> = {}): ImportRun {
  const run: ImportRun = {
    id: `recRun${String(world.runs.size + 1)}`,
    eventId: 'recEvent',
    source: 'sessionize',
    sourceRef: 'endpoint',
    mapping: EMPTY_IMPORT_MAPPING,
    status: 'queued',
    phase: 'metadata',
    counts: {},
    needsEmail: [],
    ...overrides,
  }
  world.runs.set(run.id, run)
  return run
}

/** The mapping rows written so far, addressed the way `loadRemoteIndex` addresses them. */
export function indexOf(world: World): RemoteIndex {
  const index = new Map<string, IntegrationMapping>()
  world.mappings.forEach((write, at) => {
    index.set(write.remoteId, { ...write, id: `recMap${String(at)}` })
  })
  return index
}

export function ports(world: World): ImportWritePorts {
  const mint = (prefix: string): Promise<string> => {
    world.nextId += 1
    return Promise.resolve(`${prefix}${String(world.nextId)}`)
  }
  const note = (line: string): Promise<void> => {
    world.calls.push(line)
    return Promise.resolve()
  }
  // What the DAL actually stores, so the Needs-email derivation has something to read.
  // `speakerFields` runs every column through `compact`, which drops `undefined` and keeps
  // an empty string, so an import that writes `email: ''` really does leave a blank cell.
  const store = (id: string, draft: { firstName?: string; lastName?: string; email: string }) => {
    world.speakers.set(id, {
      id,
      name: `${draft.firstName ?? ''} ${draft.lastName ?? ''}`.trim(),
      email: draft.email,
    })
    return id
  }

  return {
    createLookup: (draft) => {
      world.calls.push(`createLookup:${draft.kind}:${draft.name}`)
      return mint('recLookup')
    },
    renameLookup: (change) => note(`renameLookup:${change.kind}:${change.id}`),
    upsertSpeakerByEmail: async (draft) => {
      world.calls.push(`upsertSpeaker:${draft.email}`)
      // Matches on the email column, so a second run finds the row the first one wrote.
      const held = [...world.speakers.values()].find((one) => one.email === draft.email)
      return store(held?.id ?? (await mint('recSpeaker')), draft)
    },
    createSpeaker: async (draft) => {
      world.calls.push(`createSpeaker:${draft.firstName ?? ''}`)
      return store(await mint('recSpeaker'), draft)
    },
    updateSpeaker: async (update) => {
      store(update.speakerId, update.draft)
      await note(`updateSpeaker:${update.speakerId}`)
    },
    createSubmission: async (input) => {
      world.calls.push(`createSubmission:${input.draft.title}:${String(input.participants.length)}`)
      const id = await mint('recSub')
      world.cast.set(
        id,
        input.participants.map((member) => member.speakerId),
      )
      return id
    },
    // The real adapter reads the rows back and writes only what is missing, so the fake
    // holds rows rather than counting calls: an additive write is only additive if a
    // second run over the same cast writes nothing.
    addParticipants: (change) => {
      const held = world.cast.get(change.submissionId) ?? []
      const missing = missingCast(held, change.participants)
      world.cast.set(change.submissionId, [...held, ...missing.map((one) => one.speakerId)])
      world.calls.push(`addParticipants:${change.submissionId}:${String(missing.length)}`)
      return Promise.resolve(missing.length)
    },
    updateSubmission: (change) => note(`updateSubmission:${change.submissionId}`),
    scheduleSubmission: (change) =>
      note(`schedule:${change.submissionId}:${change.roomId ?? 'none'}`),
    saveMappings: (writes) => {
      world.mappings.push(...writes)
      return note(`saveMappings:${String(writes.length)}`)
    },
  }
}

export type DepsOverrides = Partial<ImportRunDeps> & { normalized?: NormalizedImport }

export function worldDeps(world: World, overrides: DepsOverrides = {}): ImportRunDeps {
  const { normalized = NORMALIZED, ...rest } = overrides
  return {
    getRun: (runId) => {
      const run = world.runs.get(runId)
      if (run === undefined) return Promise.reject(new Error(`no run ${runId}`))
      return Promise.resolve(run)
    },
    claimRun: (write, claim) => {
      const run = world.runs.get(write.runId)
      if (run !== undefined) {
        world.runs.set(write.runId, {
          ...run,
          status: 'running',
          leaseHolder: claim.leaseHolder,
          startedAt: claim.startedAt ?? run.startedAt,
        })
      }
      return Promise.resolve()
    },
    advanceRun: (write, progress) => {
      const run = world.runs.get(write.runId)
      if (run !== undefined) world.runs.set(write.runId, { ...run, ...progress })
      world.calls.push(`advance:${progress.phase}`)
      return Promise.resolve()
    },
    finishRun: (write, outcome) => {
      const run = world.runs.get(write.runId)
      if (run !== undefined) {
        world.runs.set(write.runId, {
          ...run,
          status: outcome.status,
          needsEmail: outcome.needsEmail ?? run.needsEmail,
        })
      }
      world.outcomes.push(outcome)
      return Promise.resolve()
    },
    heldBy: (runId) => Promise.resolve(world.runs.get(runId)?.leaseHolder),
    loadRemoteIndex: () => Promise.resolve(indexOf(world)),
    readSpeakers: () => Promise.resolve([...world.speakers.values()]),
    fetch: (_request, guard) =>
      Promise.resolve({
        normalized: guardApplied(normalized, guard.authoredRemoteIds),
        categories: [],
      }),
    write: ports(world),
    claim: () => Promise.resolve({ granted: true }),
    holder: 'worker-1',
    now: () => '2026-08-09T12:00:00.000Z',
    ...rest,
  }
}

/**
 * Stands in for `normalizeAccelevents`, which is the real consumer of the guard.
 *
 * The ENGINE's job is to supply that set from `IntegrationMappings` and to let the skip
 * count reach the preview and the run row, so the fake applies it exactly the way the
 * mapper does: drop the row, and add one to `skipped`.
 */
export function guardApplied(
  normalized: NormalizedImport,
  authored: ReadonlySet<string>,
): NormalizedImport {
  if (authored.size === 0) return normalized
  const kept = normalized.submissions.filter((row) => !authored.has(row.remoteId))
  return {
    ...normalized,
    submissions: kept,
    skipped: {
      ...normalized.skipped,
      submissions: normalized.skipped.submissions + (normalized.submissions.length - kept.length),
    },
  }
}
