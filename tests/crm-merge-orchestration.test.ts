// `mergeSpeakers` end to end against the in-memory Airtable API.
//
// This is the only irreversible write in the product: it deletes Speakers rows, and Airtable
// has no undo an app can reach. The RULES it applies are pure and covered by
// tests/crm-merge.test.ts; what is covered here is the ORCHESTRATION, where the remaining
// failure modes live:
//
//   - deletes must happen after every repoint, or the links point at a record that is gone;
//   - every table that links a speaker must actually be repointed, because the regression a
//     future edit causes is dropping one of them from the sequence;
//   - a failure partway must leave a state somebody can recover from, and these tests say
//     what that state IS rather than pretending the sequence is atomic;
//   - invalidation must fire even when a write throws.
//
// The fixture and the wiring are in tests/helpers/merge-world.ts. That helper is built on
// `fakeSpeakersApi`, the in-memory Airtable data API the CRM write tests already share, so a
// merge here goes through the real `getClient()`, the real scheduler and a real stubbed
// `fetch`: the assertions are about the requests that actually went out.

import { beforeAll, describe, expect, it, vi } from 'vitest'

import { fakeSpeakersApi } from './helpers/fake-speakers-api'
import {
  BYSTANDER,
  DUP_A,
  DUP_B,
  initialStore,
  LINK_TABLES,
  mergeHarness,
  PRIMARY,
  runMerge,
  tableOf,
} from './helpers/merge-world'

const revalidateTag = vi.hoisted(() => vi.fn())

vi.mock('next/cache', () => ({ revalidateTag }))

type World = Awaited<ReturnType<typeof runMerge>>

/**
 * One link cell, by column name, read through a Map.
 *
 * Through a Map for the same reason `view()` in records.ts is: a bracket lookup by a
 * name held in a variable is an object-injection sink, and the lint rule is right about
 * it even in a test.
 */
function linkCell(fields: Record<string, unknown>, column: string): readonly string[] {
  const value = new Map(Object.entries(fields)).get(column)
  return Array.isArray(value) ? (value as readonly string[]) : []
}

// One merge for the whole success suite. It is a dozen requests through the real scheduler,
// which spaces them, so running it per assertion would cost seconds for nothing: the store is
// inspected afterwards and no assertion below mutates it.
describe('a merge that completes', () => {
  let world: World

  beforeAll(async () => {
    world = await runMerge({ revalidateTag })
  })

  it('reports what it did, so the toast can name the deletes rather than say "saved"', () => {
    expect(world.error).toBeUndefined()
    expect(world.result).toEqual({
      primaryId: PRIMARY,
      absorbed: 2,
      sessionsMoved: 1,
      sessionsDeduplicated: 1,
      tagsMoved: 2,
    })
  })

  it('deletes the absorbed records and keeps the survivor and the bystander', () => {
    expect(world.ids('Speakers')).toEqual([PRIMARY, BYSTANDER])
  })

  it('gives the survivor the UNION of every event, including one outside the caller scope', () => {
    // The whole point of reading the rows rather than the CRM's scoped roster: `e3` is on the
    // absorbed record and on no event this organizer belongs to. Building the union from the
    // directory would have written `['e1','e2']` and unlinked the survivor from that event.
    expect(world.fields('Speakers', PRIMARY)?.events).toEqual(['e1', 'e2', 'e3'])
  })

  it('writes no identity field on the survivor, which is what "keeps its own name" means', () => {
    expect(world.fields('Speakers', PRIMARY)?.email).toBe('priya@work.com')
  })

  it.each(LINK_TABLES)('repoints every row in %s.%s onto the survivor', (table, column) => {
    const rows = world.api.rows(table)

    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      // No row may still name a record this merge deleted, and at least one must have moved.
      expect(linkCell(row.fields, column)).not.toContain(DUP_A)
      expect(linkCell(row.fields, column)).not.toContain(DUP_B)
    }
    expect(rows.some((row) => linkCell(row.fields, column).at(0) === PRIMARY)).toBe(true)
  })

  it('leaves a row belonging to somebody else alone', () => {
    expect(world.fields('TaskAssignments', 'recTA2')?.speaker).toEqual([BYSTANDER])
    expect(world.fields('SubmissionParticipants', 'recP4')?.speaker).toEqual([BYSTANDER])
    expect(world.fields('SpeakerTags', 'recTag3')?.speakers).toEqual([BYSTANDER])
  })

  it('collapses a tag both records carried instead of listing the survivor twice', () => {
    expect(world.fields('SpeakerTags', 'recTag1')?.speakers).toEqual([PRIMARY])
  })

  it('moves a tag only the absorbed record carried, keeping its other members', () => {
    expect(world.fields('SpeakerTags', 'recTag2')?.speakers).toEqual([PRIMARY, BYSTANDER])
  })

  it('drops the duplicate cast row rather than casting one person on a session twice', () => {
    expect(world.ids('SubmissionParticipants')).toEqual(['recP1', 'recP3', 'recP4'])
  })

  it('promotes the surviving cast row when the one it replaced was the primary presenter', () => {
    // Without this the session ends up with no primary at all, and `Submission.submitter` is
    // read off that flag.
    expect(world.fields('SubmissionParticipants', 'recP1')?.isPrimary).toBe(true)
  })

  it('repoints a cast row on a session the survivor was not already on', () => {
    expect(world.fields('SubmissionParticipants', 'recP3')?.speaker).toEqual([PRIMARY])
  })

  it('deletes the speakers LAST, after every repoint has gone out', () => {
    const speakerDelete = world.calls.findIndex(
      (call) => call.method === 'DELETE' && call.table === 'Speakers',
    )
    expect(speakerDelete).toBeGreaterThan(-1)

    // Every write to every other table precedes it. Reordering the delete to the front of
    // `mergeSpeakers` fails here, and that reordering is the bug worth catching: it leaves
    // sessions, files and notes pointing at a record id that no longer resolves.
    const lastOtherWrite = world.calls.reduce(
      (latest, call, index) =>
        call.method !== 'GET' && call.table !== 'Speakers' ? index : latest,
      -1,
    )
    expect(speakerDelete).toBeGreaterThan(lastOtherWrite)
  })

  it('touches every link table on the wire, so none can be silently dropped', () => {
    const written = new Set(
      world.calls.filter((call) => call.method !== 'GET').map((call) => call.table),
    )

    for (const [table] of LINK_TABLES) expect(written.has(table)).toBe(true)
    expect(written.has('SubmissionParticipants')).toBe(true)
    expect(written.has('SpeakerTags')).toBe(true)
  })

  it('expires the tags a merge actually affects, both sides and every event in the union', () => {
    expect(world.tags).toContain('speaker-tags')
    for (const id of [PRIMARY, DUP_A, DUP_B]) {
      expect(world.tags).toContain(`speaker:${id}`)
      expect(world.tags).toContain(`speaker:${id}:tasks`)
      expect(world.tags).toContain(`speaker:${id}:files`)
      expect(world.tags).toContain(`speaker:${id}:file-requests`)
      expect(world.tags).toContain(`speaker:${id}:comms`)
      expect(world.tags).toContain(`speaker:${id}:notes`)
      expect(world.tags).toContain(`speaker:${id}:stage-history`)
    }
    for (const eventId of ['e1', 'e2', 'e3']) {
      expect(world.tags).toContain(`event:${eventId}:speakers`)
      expect(world.tags).toContain(`event:${eventId}:submissions`)
    }
  })

  it('expires nothing belonging to an event neither record is on', () => {
    // Over-invalidation is a defect here, not a style nit (BUILD_SPEC 6.1): a merge must not
    // expire the abstracts table of every other conference in the base.
    expect(world.tags).not.toContain('event:e9:speakers')
    expect(world.tags).not.toContain('event:e9:submissions')
    expect(world.tags).not.toContain(`speaker:${BYSTANDER}`)
  })
})

// A merge is a sequence of independent requests and Airtable has no transaction, so any one
// of them can be the last that lands. These pin what that leaves behind, at the two ends of
// the sequence: the earliest write and the write immediately before the delete.
describe('a merge that fails partway', () => {
  it('deletes nothing when the FIRST write after the event union fails', async () => {
    const world = await runMerge({
      revalidateTag,
      failAfter: { table: 'SpeakerTags', afterWrites: 0, status: 401 },
    })

    expect(world.error).toBeDefined()
    expect(world.ids('Speakers')).toEqual([PRIMARY, DUP_A, DUP_B, BYSTANDER])
  })

  it('deletes nothing when the LAST repoint before the delete fails', async () => {
    // Submissions is the final entry in `SPEAKER_LINK_TABLES`, so this is the tightest case
    // for "the delete is last": everything else has already succeeded.
    const world = await runMerge({
      revalidateTag,
      failAfter: { table: 'Submissions', afterWrites: 0, status: 401 },
    })

    expect(world.error).toBeDefined()
    expect(world.ids('Speakers')).toContain(DUP_A)
    expect(world.ids('Speakers')).toContain(DUP_B)
  })

  it('leaves the links it had already moved on the survivor, and says so honestly', async () => {
    const world = await runMerge({
      revalidateTag,
      failAfter: { table: 'SpeakerStageHistory', afterWrites: 0, status: 401 },
    })

    // This is the real cost of having no transaction. The earlier repoints landed, so the
    // absorbed record now looks emptier than it was while still existing. It is recoverable
    // rather than corrupt: every step is idempotent, so pressing Merge again finishes the
    // job. The file header of mutations-crm-merge.ts states this; this is what stops that
    // paragraph being aspirational.
    expect(world.fields('Files', 'recF1')?.speaker).toEqual([PRIMARY])
    expect(world.fields('SpeakerStageHistory', 'recH1')?.speaker).toEqual([DUP_B])
  })

  it('still expires its tags when a write throws, because invalidation is in a finally', async () => {
    const world = await runMerge({
      revalidateTag,
      failAfter: { table: 'SpeakerTags', afterWrites: 0, status: 401 },
    })

    // The event union was already written to the survivor before the failure, so a cache
    // entry that predates it must not be left serving.
    expect(world.tags).toContain(`speaker:${PRIMARY}`)
    expect(world.tags).toContain('event:e3:speakers')
  })

  it('finishes the job when the same merge is re-run after a failure', async () => {
    // Idempotence is what makes "press it again" the correct recovery, so it is asserted
    // rather than asserted about: a second run over a half-merged base must complete it and
    // must not double anything.
    let failing = true
    const api = fakeSpeakersApi({ initial: initialStore() })
    const harness = await mergeHarness((url, init) => {
      const method = init?.method ?? 'GET'
      if (failing && method !== 'GET' && tableOf(url) === 'SpeakerStageHistory') {
        return Promise.resolve(new Response('rejected', { status: 401 }))
      }
      return api.fetchImpl(url, init)
    })

    await expect(harness.merge()).rejects.toThrow()
    failing = false
    const second = await harness.merge()
    harness.done()

    expect(api.rows('Speakers').map((row) => row.id)).toEqual([PRIMARY, BYSTANDER])
    expect(api.rows('Speakers').at(0)?.fields.events).toEqual(['e1', 'e2', 'e3'])
    // The cast rows were already settled by the first run, so the second moves none of them
    // and removes none: re-running completes a merge, it does not repeat one.
    expect(second.sessionsMoved).toBe(0)
    expect(second.sessionsDeduplicated).toBe(0)
    expect(api.rows('SubmissionParticipants').map((row) => row.id)).toEqual([
      'recP1',
      'recP3',
      'recP4',
    ])
  })
})

describe('a merge naming a record that has since been deleted', () => {
  it('refuses before writing anything at all', async () => {
    const store = initialStore()
    const api = fakeSpeakersApi({
      initial: { ...store, Speakers: store.Speakers.filter((row) => row.id !== DUP_B) },
    })
    const harness = await mergeHarness(api.fetchImpl)

    await expect(harness.merge()).rejects.toThrow(/no longer exists/)
    harness.done()

    // Nothing written. Airtable's batch delete is all-or-nothing, so a dead id discovered at
    // step 5 would reject the delete after every link had already moved onto the survivor.
    expect(harness.calls.filter((call) => call.method !== 'GET')).toEqual([])
    expect(api.rows('SpeakerTags').at(0)?.fields.speakers).toEqual([PRIMARY, DUP_A])
  })
})
