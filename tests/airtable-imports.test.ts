// ImportRuns in both directions: the mapper's defaults, and the field builders.
//
// The reads are in tests/airtable-imports-reads.test.ts, split for the line budget along
// the seam that was already there: this file never touches the network, and that one is
// mostly about what reaches it.
//
// Written in wire shape by hand rather than round-tripped through the field builders, for
// the reason tests/airtable-mapping-portal.test.ts gives: a round trip agrees with itself
// even when both halves are wrong.
//
// What is asserted is the decisions, not the plumbing. `status` and `phase` have to be
// wrong VISIBLY rather than destructively, and the `needsEmailJson` fallback only stays
// honest because the write side keeps "checked, nobody" and "never checked" in different
// cells. Both halves of that argument are here, next to each other.

import { describe, expect, it } from 'vitest'

import { ErrorIds, isAppError } from '@/constants/errorIds'
import { mapImportRun } from '@/services/airtable/mapping-imports'
import type { AirtableRecord } from '@/services/airtable/records'
import {
  importRunClaimFields,
  importRunFields,
  importRunOutcomeFields,
  importRunProgressFields,
} from '@/services/airtable/to-fields-imports'
import { EMPTY_IMPORT_MAPPING } from '@/types/imports'

function record(id: string, fields: Record<string, unknown>): AirtableRecord {
  return { id, fields }
}

function errorId(thrown: unknown): string {
  return isAppError(thrown) ? thrown.id : `not an AppError: ${String(thrown)}`
}

function caught(fn: () => unknown): unknown {
  try {
    fn()
    return undefined
  } catch (error) {
    return error
  }
}

/** The three columns with no safe default, so every row below carries them. */
const RUN_CORE = { event: ['recEvent1'], source: 'sessionize', sourceRef: 'jl4ktls0' }

describe('mapImportRun', () => {
  it('reads a finished run whole', () => {
    const run = mapImportRun(
      record('recRun1', {
        ...RUN_CORE,
        status: 'done',
        phase: 'agenda',
        mappingJson: JSON.stringify({ categories: { '1234': 'track', '5678': 'ignore' } }),
        counts: JSON.stringify({ speaker: { created: 12, updated: 3, skipped: 0 } }),
        needsEmailJson: JSON.stringify([{ speakerId: 'recSpk1', name: 'Ada', remoteId: 'g-1' }]),
        startedAt: '2026-08-09T09:00:00.000Z',
        finishedAt: '2026-08-09T09:04:00.000Z',
      }),
    )

    expect(run.eventId).toBe('recEvent1')
    expect(run.mapping.categories).toEqual({ '1234': 'track', '5678': 'ignore' })
    expect(run.counts.speaker).toEqual({ created: 12, updated: 3, skipped: 0 })
    expect(run.needsEmail).toHaveLength(1)
    expect(run.leaseHolder).toBeUndefined()
  })

  it('reads a blank status as failed, never as done', () => {
    const run = mapImportRun(record('recRun2', RUN_CORE))

    // `done` would hide a run that never ran. `queued` and `running` are visible but not
    // inert: `dueImportRuns` acts on exactly those two, so a row nobody wrote a status
    // for would be handed to a job that starts writing records. `failed` is the only
    // value that is both visible and terminal.
    expect(run.status).toBe('failed')
  })

  it('reads a blank phase as the FIRST phase', () => {
    const run = mapImportRun(record('recRun3', RUN_CORE))

    // Redoing metadata costs a wall of updates, because `IntegrationMappings` turns a
    // re-import into an update. Defaulting to the last phase would skip speakers and
    // submissions entirely and finish claiming success with an empty event.
    expect(run.phase).toBe('metadata')
  })

  it('falls back to empty blobs on a row that has written none of them', () => {
    const run = mapImportRun(record('recRun4', RUN_CORE))

    // Empty is the NORMAL reading of `mappingJson`, not a degraded one: two of the three
    // sources type their taxonomies on their own side and store nothing here.
    expect(run.mapping).toEqual(EMPTY_IMPORT_MAPPING)
    // A run reporting no counts is visibly incomplete, so `{}` flatters nothing.
    expect(run.counts).toEqual({})
    // `[]` is the fallback that COULD flatter, because it renders the same as "everybody
    // had an address". It is safe only because the column is written once at finish, so a
    // blank one is the normal state of every queued and running row, and because
    // `importRunOutcomeFields` writes `[]` explicitly when a run checked and found none.
    expect(run.needsEmail).toEqual([])
  })

  it('throws on a blob that is present and does not parse', () => {
    const thrown = caught(() =>
      mapImportRun(record('recRun5', { ...RUN_CORE, counts: '{not json' })),
    )

    // The fallbacks above only ever answer an EMPTY column. Corruption stays loud, which
    // is what stops `[]` from being a way for a lost Needs-email list to arrive quietly.
    expect(errorId(thrown)).toBe(ErrorIds.DATA_SHAPE_INVALID)
  })

  it('rejects a needsEmail row that is missing its speaker', () => {
    const thrown = caught(() =>
      mapImportRun(
        record('recRun6', { ...RUN_CORE, needsEmailJson: JSON.stringify([{ name: 'Ada' }]) }),
      ),
    )

    // The list exists so an organizer can open each speaker and fill the address in. A
    // row with no `speakerId` is a name with nothing to click, which is worse than a
    // shorter list, because it looks like the work is possible.
    expect(errorId(thrown)).toBe(ErrorIds.DATA_SHAPE_INVALID)
  })

  it('refuses a row with no source, because there is no safe guess', () => {
    const thrown = caught(() =>
      mapImportRun(record('recRun7', { event: ['recEvent1'], sourceRef: 'jl4ktls0' })),
    )

    // `source` decides which API is called and how `sourceRef` is read. A default would
    // point a Sessionize fetch at a Sessionboard event id and import nothing, successfully.
    expect(errorId(thrown)).toBe(ErrorIds.DATA_SHAPE_INVALID)
  })
})

describe('the ImportRuns write direction', () => {
  it('queues a run with its status and phase written, not defaulted', () => {
    const fields = importRunFields({
      eventId: 'recEvent1',
      source: 'sessionize',
      sourceRef: 'jl4ktls0',
      mapping: EMPTY_IMPORT_MAPPING,
    })

    expect(fields).toEqual({
      event: ['recEvent1'],
      source: 'sessionize',
      sourceRef: 'jl4ktls0',
      mappingJson: '{"categories":{}}',
      status: 'queued',
      phase: 'metadata',
      counts: '{}',
    })
    // ABSENT, not `[]`. An empty list is the run saying it looked for speakers with no
    // address and found none, and it has not looked at anything yet. That distinction is
    // the whole reason the mapper's `[]` fallback is defensible.
    expect(fields).not.toHaveProperty('needsEmailJson')
  })

  it('records a claim without re-stamping startedAt on a resume', () => {
    const first = importRunClaimFields({
      leaseHolder: 'sweep-1',
      leaseExpiresAt: '2026-08-09T09:05:00.000Z',
      startedAt: '2026-08-09T09:00:00.000Z',
    })
    const resumed = importRunClaimFields({
      leaseHolder: 'sweep-2',
      leaseExpiresAt: '2026-08-09T09:10:00.000Z',
    })

    expect(first.startedAt).toBe('2026-08-09T09:00:00.000Z')
    // Omitted, so the row keeps the instant it began. Re-stamping would make a long
    // import look like it started seconds ago every time it was picked up.
    expect(resumed).not.toHaveProperty('startedAt')
    expect(resumed.status).toBe('running')
  })

  it('replaces the run totals when a phase finishes', () => {
    const fields = importRunProgressFields({
      phase: 'submissions',
      counts: { submission: { created: 40, updated: 2, skipped: 1 } },
    })

    expect(fields).toEqual({
      phase: 'submissions',
      counts: '{"submission":{"created":40,"updated":2,"skipped":1}}',
    })
  })

  it('clears the lease and the error when a run finishes', () => {
    const fields = importRunOutcomeFields({
      status: 'done',
      finishedAt: '2026-08-09T09:04:00.000Z',
      needsEmail: [],
    })

    // `null`, not absent. A stale holder on a terminal row is what makes a later reader
    // unsure whether a dead isolate is still working on it, and the sweep's lapsed-lease
    // branch would eventually hand the row to a job with nothing to do.
    expect(fields.leaseHolder).toBeNull()
    expect(fields.leaseExpiresAt).toBeNull()
    // Cleared too, or a recovered run reads `done` while still displaying the error it
    // got past.
    expect(fields.error).toBeNull()
    // Written even though it is empty: this is "checked, nobody needs an address".
    expect(fields.needsEmailJson).toBe('[]')
  })

  it('leaves needsEmailJson alone when the run never got that far', () => {
    const fields = importRunOutcomeFields({
      status: 'failed',
      finishedAt: '2026-08-09T09:01:00.000Z',
      error: 'sessionize returned 404',
    })

    // A run that failed in `metadata` has nothing to say about speakers, and `[]` here
    // would be it claiming otherwise.
    expect(fields).not.toHaveProperty('needsEmailJson')
    expect(fields.error).toBe('sessionize returned 404')
  })
})
