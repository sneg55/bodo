// The base a speaker merge runs against, and the runner that drives one.
//
// Extracted from tests/crm-merge-orchestration.test.ts when that file crossed the size limit.
// The seam is the usual one for this repo: the FIXTURE and the wiring live here, the
// assertions live in the test, so a second merge test (a different failure injection, a
// different starting shape) reuses the store rather than re-declaring eleven tables.
//
// It is built on `fakeSpeakersApi`, the in-memory Airtable data API the CRM write tests
// already share, so a merge here goes through the real `getClient()`, the real scheduler and
// a real stubbed `fetch`. `vi.mock('next/cache')` cannot live in a helper - the hoisting is
// per module - so the test owns that and hands its `revalidateTag` spy to `runMerge`.
//
// The CALL LOG is wrapped around the helper's `fetchImpl` rather than added to the helper.
// `fakeSpeakersApi.writeLog` records POST and PATCH only, because a DELETE returns before it
// is pushed, and order relative to the deletes is half of what the merge test asserts.

import type { Mock } from 'vitest'
import { vi } from 'vitest'

import { fakeSpeakersApi } from './fake-speakers-api'

export const PRIMARY = 'recPrimary'
export const DUP_A = 'recDupA'
export const DUP_B = 'recDupB'
export const BYSTANDER = 'recBystander'

/**
 * The single links a merge repoints, as `[table, column]`, in `SPEAKER_LINK_TABLES` order.
 *
 * The COLUMN is part of the fixture because it is not always `speaker`, and a list that
 * assumed it was is exactly how `Submissions.submitter` went unrepointed for a while.
 */
export const LINK_TABLES = [
  ['TaskAssignments', 'speaker'],
  ['FileRequestAssignments', 'speaker'],
  ['Files', 'speaker'],
  ['EmailOutbox', 'speaker'],
  ['SpeakerNotes', 'speaker'],
  ['SpeakerStageHistory', 'speaker'],
  ['Submissions', 'submitter'],
] as const

/**
 * A base with one duplicate cluster in it and one bystander who must come out untouched.
 *
 * `recDupB` sits on `e3`, an event the merging organizer holds no membership on. That is the
 * data-loss case the event union exists for: building it from the CRM's scoped roster instead
 * of from the Speakers rows would write `['e1','e2']` back and silently unlink the survivor
 * from a conference nobody in this session can see.
 *
 * A function and not a constant, because every run mutates it.
 */
export function initialStore() {
  return {
    Speakers: [
      { id: PRIMARY, fields: { email: 'priya@work.com', events: ['e1'] } },
      { id: DUP_A, fields: { email: 'priya@personal.com', events: ['e2'] } },
      { id: DUP_B, fields: { email: 'p.raman@old.com', events: ['e3'] } },
      { id: BYSTANDER, fields: { email: 'bo@example.com', events: ['e9'] } },
    ],
    SpeakerTags: [
      // Both sides carry it, so the moved id must collapse rather than appear twice.
      { id: 'recTag1', fields: { name: 'Keynote', speakers: [PRIMARY, DUP_A] } },
      { id: 'recTag2', fields: { name: 'Local', speakers: [DUP_B, BYSTANDER] } },
      { id: 'recTag3', fields: { name: 'Unused here', speakers: [BYSTANDER] } },
    ],
    // The abstracts the cast below belongs to, and the one table where a missed repoint is
    // unrecoverable: `mapSubmission` reads `submitter` as a required link, and every
    // submissions read maps the whole table before filtering by event.
    Submissions: [
      { id: 'sub1', fields: { event: ['e1'], title: 'Evaluating agents', submitter: [DUP_A] } },
      { id: 'sub2', fields: { event: ['e3'], title: 'Incremental CI', submitter: [DUP_B] } },
      { id: 'sub3', fields: { event: ['e9'], title: 'Somebody else', submitter: [BYSTANDER] } },
    ],
    SubmissionParticipants: [
      { id: 'recP1', fields: { submission: ['sub1'], speaker: [PRIMARY] } },
      // Same session as recP1 AND the primary presenter: the collapse plus the promotion.
      { id: 'recP2', fields: { submission: ['sub1'], speaker: [DUP_A], isPrimary: true } },
      { id: 'recP3', fields: { submission: ['sub2'], speaker: [DUP_B] } },
      { id: 'recP4', fields: { submission: ['sub3'], speaker: [BYSTANDER] } },
    ],
    TaskAssignments: [
      { id: 'recTA1', fields: { speaker: [DUP_A] } },
      { id: 'recTA2', fields: { speaker: [BYSTANDER] } },
    ],
    FileRequestAssignments: [{ id: 'recFR1', fields: { speaker: [DUP_B] } }],
    Files: [{ id: 'recF1', fields: { speaker: [DUP_A] } }],
    // Carries an `event` link as well as a speaker, which Submissions is not alone in doing
    // and which the tag mapping has to tell apart. See crm-merge-submitter.test.ts.
    EmailOutbox: [{ id: 'recO1', fields: { event: ['e1'], speaker: [DUP_B] } }],
    SpeakerNotes: [{ id: 'recN1', fields: { speaker: [DUP_A] } }],
    SpeakerStageHistory: [{ id: 'recH1', fields: { speaker: [DUP_B] } }],
  }
}

export type Call = { method: string; table: string }

export function tableOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.split('/').slice(3).join('/'))
}

const ORIGINAL_ENV = { ...process.env }

/** The credentials `getClient()` needs, plus a module reset so the scheduler starts fresh. */
function prepareEnv(): void {
  process.env = { ...ORIGINAL_ENV, AIRTABLE_TOKEN: 'patTest', AIRTABLE_BASE_ID: 'appTest' }
  vi.resetModules()
}

function restoreEnv(): void {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL_ENV }
}

/** Installs a `fetch` that logs every request before delegating, and returns the log. */
export function logged(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', table: tableOf(url) })
    return fetchImpl(url, init)
  })
  return calls
}

export async function importMerge() {
  return await import('@/services/airtable/mutations-crm-merge')
}

export type MergeOptions = Parameters<typeof fakeSpeakersApi>[0] & {
  /** The test's `revalidateTag` spy, cleared before the run and read back after it. */
  readonly revalidateTag: Mock
  /** Rows to start from, defaulting to `initialStore()`. */
  readonly store?: ReturnType<typeof initialStore>
}

/**
 * One merge of `DUP_A` and `DUP_B` into `PRIMARY`, against a fresh store.
 *
 * Never throws: the error is returned alongside the store, because every failure case here is
 * about what the base looks like AFTERWARDS rather than about the message.
 */
export async function runMerge({ revalidateTag, store, ...options }: MergeOptions) {
  prepareEnv()
  revalidateTag.mockClear()

  const api = fakeSpeakersApi({ initial: store ?? initialStore(), ...options })
  const calls = logged(api.fetchImpl)
  const { mergeSpeakers } = await importMerge()

  let error: unknown
  let result: Awaited<ReturnType<typeof mergeSpeakers>> | undefined
  try {
    result = await mergeSpeakers('action', { primaryId: PRIMARY, absorbedIds: [DUP_A, DUP_B] })
  } catch (caught) {
    error = caught
  }

  restoreEnv()

  return {
    api,
    calls,
    result,
    error,
    tags: revalidateTag.mock.calls.map((call): unknown => call[0]),
    fields: (table: string, id: string) => api.rows(table).find((row) => row.id === id)?.fields,
    ids: (table: string) => api.rows(table).map((row) => row.id),
  }
}

/** The same wiring for a test that drives `mergeSpeakers` itself, e.g. to run it twice. */
export async function mergeHarness(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
) {
  prepareEnv()
  const calls = logged(fetchImpl)
  const { mergeSpeakers } = await importMerge()
  return {
    calls,
    merge: async () =>
      await mergeSpeakers('action', { primaryId: PRIMARY, absorbedIds: [DUP_A, DUP_B] }),
    done: restoreEnv,
  }
}
