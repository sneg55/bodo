// The mock Accelevents client. This is the demo path, not a test stub.
//
// Until a real test event and enterprise key arrive, ACCELEVENTS_MOCK=1 routes
// every call here so the accept-and-sync flow is demonstrable: payloads are
// recorded and ids are assigned.
//
// It records into module state, which is per-isolate and therefore NOT durable.
// Writing SyncLog is the orchestration layer's job (sync.ts, still to be built),
// and it must write for both the live and the mock adapter so the Settings log and
// the retry sweep work identically either way. `mockCalls()` is an in-request aid
// and a test seam, nothing more; do not build the admin log on top of it.
//
// It deliberately reproduces the two behaviours that are easy to get wrong
// against the real API, so the code paths around them are exercised rather than
// discovered on the first live run:
//
//   1. A second createSpeaker with an email it has already seen fails with the
//      duplicate-email error, which forces the caller through the lookup branch.
//   2. Ids are opaque and assigned by the remote side, so nothing downstream can
//      quietly assume it can predict or reconstruct them.
//
// What the mock CANNOT prove, and BUILD_SPEC §5.7 says so: the shape of a real
// validation error, the prerequisite ordering the live API enforces, and whether
// the enterprise key has the scopes we need. Going live is integration work, not
// a config flip.

import { AppError, ErrorIds } from '@/constants/errorIds'

import type {
  AccelClient,
  RemoteRef,
  SessionPayload,
  SpeakerPayload,
  TaxonomyPayload,
} from '@/services/accelevents/client'
import { DUPLICATE_EMAIL_CODE } from '@/services/accelevents/client'

export type MockCall = {
  kind:
    | 'speaker.create'
    | 'speaker.update'
    | 'session.create'
    | 'session.update'
    | 'taxonomy.create'
  eventUrl: string
  remoteId: string
  payload: SpeakerPayload | SessionPayload | TaxonomyPayload
}

/**
 * Per-isolate recording. It is module state, which the Workers rules forbid for
 * anything that must persist, and that is fine here precisely because nothing
 * must: SyncLog in Airtable is the durable record, and this is only an in-request
 * aid for the admin "Sync now" screen and for tests.
 */
const calls: MockCall[] = []
const speakerIdsByEmail = new Map<string, string>()
let counter = 0

/** Deterministic ids, so a fixture-backed demo produces stable screenshots. */
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}_mock_${String(counter).padStart(4, '0')}`
}

function record(call: MockCall): RemoteRef {
  calls.push(call)
  return { remoteId: call.remoteId, existed: call.kind.endsWith('update') }
}

export function mockCalls(): readonly MockCall[] {
  return calls
}

export function resetMock(): void {
  calls.length = 0
  speakerIdsByEmail.clear()
  counter = 0
}

function emailKey(eventUrl: string, email: string): string {
  // Scoped by event, because Accelevents ids are event-scoped and so is the
  // uniqueness rule. A speaker at two events is two remote records.
  return `${eventUrl}::${email.trim().toLowerCase()}`
}

export const mockClient: AccelClient = {
  createSpeaker(eventUrl, payload) {
    const key = emailKey(eventUrl, payload.email)
    if (speakerIdsByEmail.has(key)) {
      // Same failure the real API returns, so the caller's lookup branch is a
      // path the demo actually walks rather than dead code.
      return Promise.reject(
        new AppError(ErrorIds.ACCEL_DUPLICATE_EMAIL, 'speaker email already exists', {
          code: DUPLICATE_EMAIL_CODE,
          email: payload.email,
          eventUrl,
        }),
      )
    }
    const remoteId = nextId('spk')
    speakerIdsByEmail.set(key, remoteId)
    return Promise.resolve(record({ kind: 'speaker.create', eventUrl, remoteId, payload }))
  },

  updateSpeaker(eventUrl, remoteId, payload) {
    return Promise.resolve(record({ kind: 'speaker.update', eventUrl, remoteId, payload }))
  },

  findSpeakerByEmail(eventUrl, email) {
    return Promise.resolve(speakerIdsByEmail.get(emailKey(eventUrl, email)))
  },

  createSession(eventUrl, payload) {
    return Promise.resolve(
      record({ kind: 'session.create', eventUrl, remoteId: nextId('ses'), payload }),
    )
  },

  updateSession(eventUrl, remoteId, payload) {
    return Promise.resolve(record({ kind: 'session.update', eventUrl, remoteId, payload }))
  },

  createTaxonomy(eventUrl, payload) {
    return Promise.resolve(
      record({ kind: 'taxonomy.create', eventUrl, remoteId: nextId('tax'), payload }),
    )
  },
}
