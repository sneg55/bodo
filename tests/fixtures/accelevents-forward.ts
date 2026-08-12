// Fixtures and the fake dependency set for the Accelevents forward walk.
//
// Split out of the test file, which was over the 300-line limit with them in it, and it
// is the right seam anyway: one event's records and one recording client, so a test reads
// as the behaviour it pins rather than as setup.
//
// Not a `.test.ts`, so vitest's `include` never runs it as a suite.

import { vi } from 'vitest'

import type { AccelClient, RemoteRef } from '@/services/accelevents/client'
import { hashAcceleventsPayload } from '@/services/accelevents/request-hash'
import type {
  IntegrationMapping,
  MappingWrite,
  SyncLogWrite,
} from '@/services/accelevents/sync-types'
import type { ForwardSyncDeps } from '@/services/accelevents/sync-walk'
import type { Room, Speaker, SubmissionWithParticipants, Tag, Track } from '@/types/domain'

export const EVENT_ID = 'recEvent'
export const EVENT_URL = 'ai-engineer-sandbox'

export const TRACK: Track = {
  id: 'recTrack',
  eventId: EVENT_ID,
  name: 'Agents',
  color: 'blue',
  order: 1,
}
export const TAG: Tag = { id: 'recTag', eventId: EVENT_ID, name: 'Reliability', color: 'green' }
export const ROOM: Room = { id: 'recRoom', eventId: EVENT_ID, name: 'Main Hall', order: 1 }

export const ADA: Speaker = {
  id: 'recAda',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  bio: 'Analytical engines.',
  company: 'Difference Ltd',
  links: {},
}

/** A speaker as a Sessionize import leaves them: no address at all. See `NeedsEmailRow`. */
export const NAMELESS: Speaker = {
  id: 'recNoEmail',
  email: '',
  firstName: 'Grace',
  lastName: '',
  links: {},
}

export function submission(
  overrides: Partial<SubmissionWithParticipants> = {},
): SubmissionWithParticipants {
  return {
    id: 'recSub',
    eventId: EVENT_ID,
    submitterId: ADA.id,
    code: 'SESS-1',
    title: 'Reliable agents',
    status: 'accepted',
    source: 'form',
    reviewRequired: true,
    answers: { description: '<p>How to keep them up.</p>' },
    trackId: TRACK.id,
    tagIds: [TAG.id],
    roomId: ROOM.id,
    startsAt: '2026-10-12T17:00:00.000Z',
    endsAt: '2026-10-12T17:30:00.000Z',
    scheduleStatus: 'scheduled',
    // Orthogonal to `status` and to `scheduleStatus`, and irrelevant to the push: the
    // Accelevents payload carries none of it. `not_submitted` is the neutral value, so a
    // test that starts caring about content review has to say so rather than inherit it.
    contentStatus: 'not_submitted',
    calendarSequence: 0,
    calendarStatus: 'active',
    participants: [cast(ADA)],
    ...overrides,
  }
}

export function cast(speaker: Speaker): SubmissionWithParticipants['participants'][number] {
  return {
    id: `recPart-${speaker.id}`,
    submissionId: 'recSub',
    speakerId: speaker.id,
    role: 'speaker',
    isPrimary: true,
    sortOrder: 0,
    speaker,
  }
}

export function mapping(
  entityType: IntegrationMapping['entityType'],
  localId: string,
  remoteId: string,
  requestHash: string,
): IntegrationMapping {
  return {
    id: `recMap-${localId}`,
    eventId: EVENT_ID,
    entityType,
    localId,
    remoteId,
    requestHash,
    syncedAt: '2026-08-09T11:00:00.000Z',
  }
}

export const hashOf = hashAcceleventsPayload

/**
 * What a test wants the far side to do, as plain functions.
 *
 * Overriding through these rather than through `mockImplementation` on the fake keeps the
 * call recorder wrapped around every path, so a test that changes a behaviour still gets
 * the ordering assertions the walk is judged on.
 */
export type RemoteBehaviour = {
  createSpeaker?: () => Promise<RemoteRef>
  findSpeakerByEmail?: () => Promise<string | undefined>
  createSession?: () => Promise<RemoteRef>
}

export type Harness = {
  deps: ForwardSyncDeps
  /** Remote calls in the order they were made. Order is the thing under test. */
  calls: string[]
  sessionPayloads: unknown[]
  speakerCreates: number
  logs: SyncLogWrite[]
  mappingWrites: { localId: string; remoteId: string }[]
}

export type HarnessOptions = {
  submissions?: readonly SubmissionWithParticipants[]
  mappings?: readonly IntegrationMapping[]
  granted?: boolean
  remote?: RemoteBehaviour
  writeLog?: (write: SyncLogWrite) => Promise<void>
  /** Overridden to fail the mapping write AFTER the remote has accepted the entity. */
  saveMapping?: (write: MappingWrite) => Promise<void>
}

export function harness(options: HarnessOptions = {}): Harness {
  const calls: string[] = []
  const logs: SyncLogWrite[] = []
  const sessionPayloads: unknown[] = []
  const mappingWrites: { localId: string; remoteId: string }[] = []
  const state = { speakerCreates: 0 }
  let counter = 0
  const next = (prefix: string): RemoteRef => {
    counter += 1
    return { remoteId: `${prefix}_${counter}`, existed: false }
  }
  const record = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    calls.push(name)
    return await run()
  }

  const submissions = options.submissions ?? [submission()]
  const remote = options.remote ?? {}

  const client: AccelClient = {
    createTaxonomy: (_url, payload) =>
      record(`createTaxonomy:${payload.type}`, () => Promise.resolve(next('tax'))),
    createSpeaker: (_url, _payload) =>
      record('createSpeaker', () => {
        state.speakerCreates += 1
        return remote.createSpeaker?.() ?? Promise.resolve(next('spk'))
      }),
    updateSpeaker: (_url, remoteId) =>
      record('updateSpeaker', () => Promise.resolve({ remoteId, existed: true })),
    findSpeakerByEmail: () =>
      record(
        'findSpeakerByEmail',
        () => remote.findSpeakerByEmail?.() ?? Promise.resolve(undefined),
      ),
    createSession: (_url, payload) =>
      record('createSession', () => {
        sessionPayloads.push(payload)
        return remote.createSession?.() ?? Promise.resolve(next('ses'))
      }),
    updateSession: (_url, remoteId, payload) =>
      record('updateSession', () => {
        sessionPayloads.push(payload)
        return Promise.resolve({ remoteId, existed: true })
      }),
  }

  const deps: ForwardSyncDeps = {
    getIdentity: vi.fn().mockResolvedValue({ eventUrl: EVENT_URL }),
    listMappings: vi.fn().mockResolvedValue(options.mappings ?? []),
    getSpeaker: vi.fn().mockResolvedValue(ADA),
    getSubmission: vi.fn().mockResolvedValue(submissions[0]),
    listSubmissions: vi.fn().mockResolvedValue(submissions),
    listTracks: vi.fn().mockResolvedValue([TRACK]),
    listTags: vi.fn().mockResolvedValue([TAG]),
    listRooms: vi.fn().mockResolvedValue([ROOM]),
    listForms: vi.fn().mockResolvedValue([]),
    client,
    saveMapping:
      options.saveMapping ??
      ((write) => {
        mappingWrites.push({ localId: write.localId, remoteId: write.remoteId })
        return Promise.resolve()
      }),
    writeLog:
      options.writeLog ??
      ((write) => {
        logs.push(write)
        return Promise.resolve()
      }),
    hash: hashAcceleventsPayload,
    now: () => '2026-08-09T12:00:00.000Z',
    claim: vi.fn().mockResolvedValue({ granted: options.granted ?? true }),
    holder: 'run-1',
  }

  return {
    deps,
    calls,
    logs,
    sessionPayloads,
    mappingWrites,
    get speakerCreates() {
      return state.speakerCreates
    },
  }
}
