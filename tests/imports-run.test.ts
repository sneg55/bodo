// The import run engine: dependency order, resumption, idempotency, and the two lists a
// run must not lose (Needs-email, and the round-trip skips).
//
// The fake world is `tests/helpers/imports-world.ts`. Everything here reads its ordered
// call log, because the ordering is half of what is under test: a submission cannot link a
// track that does not exist yet, so a walk that produced the right COUNTS in the wrong
// order would still be a broken import.

import { describe, expect, it } from 'vitest'

import { IMPORT_REQUEST_HASH } from '@/features/imports/ports'
import { runImport } from '@/features/imports/run'
import { acceleventsPayload, newWorld, queuedRun, worldDeps } from '../tests/helpers/imports-world'

describe('runImport', () => {
  it('walks the phases in dependency order and finishes done', async () => {
    const world = newWorld()
    const run = queuedRun(world)

    const report = await runImport(run.id, worldDeps(world))

    expect(report.attempt).toBe('done')
    expect(report.phases).toEqual(['metadata', 'speakers', 'submissions', 'agenda'])
    // Prerequisites before the records that link to them: every lookup, then every
    // speaker, then the submission that references both, then its placement.
    //
    // The mapping row follows its record IMMEDIATELY for everything an import creates
    // unconditionally, which is every entity here except Grace: she has an address, so
    // `upsertSpeakerByEmail` would find her again on the email column and her mapping is
    // the only one that can safely wait for the phase-end flush. See `MappingDedupe`.
    expect(world.calls.filter((call) => !call.startsWith('advance'))).toEqual([
      'createLookup:room:Hall A',
      'saveMappings:1',
      'createLookup:track:AI',
      'saveMappings:1',
      'createLookup:tag:Beginner',
      'saveMappings:1',
      'createSpeaker:Ada',
      'saveMappings:1',
      'upsertSpeaker:grace@example.com',
      // Grace's, written by the phase-end flush rather than beside her create.
      'saveMappings:1',
      'createSubmission:Talk one:2',
      'saveMappings:1',
      'schedule:recSub6:recLookup1',
    ])
  })

  it('counts what it created, and counts what it refused to write', async () => {
    const world = newWorld()

    const report = await runImport(queuedRun(world).id, worldDeps(world))

    expect(report.counts.room).toEqual({ created: 1, updated: 0, skipped: 0 })
    expect(report.counts.speaker).toEqual({ created: 2, updated: 0, skipped: 0 })
    // The service session bodo has no agenda row for. A visible number, not a subtraction.
    expect(report.counts.submission).toEqual({ created: 1, updated: 0, skipped: 1 })
    expect(report.counts.participant).toEqual({ created: 2, updated: 0, skipped: 0 })
  })

  it('does not redo a finished phase when it resumes', async () => {
    const world = newWorld()
    // A run whose isolate died after the speakers phase: the row says `submissions` next.
    const run = queuedRun(world, { status: 'running', phase: 'submissions' })

    const report = await runImport(run.id, worldDeps(world))

    expect(report.phases).toEqual(['submissions', 'agenda'])
    expect(world.calls.some((call) => call.startsWith('createLookup'))).toBe(false)
    expect(world.calls.some((call) => call.startsWith('createSpeaker'))).toBe(false)
  })

  it('stops at its phase budget and reports the run as advanced', async () => {
    const world = newWorld()
    const run = queuedRun(world)

    const report = await runImport(run.id, worldDeps(world, { maxPhases: 1 }))

    expect(report.attempt).toBe('advanced')
    expect(report.phases).toEqual(['metadata'])
    // The row now points at the NEXT phase, which is what makes resumption a slice.
    expect(world.runs.get(run.id)?.phase).toBe('speakers')
    expect(world.outcomes).toHaveLength(0)
  })

  it('creates nothing and updates everything on a second run', async () => {
    const world = newWorld()
    await runImport(queuedRun(world).id, worldDeps(world))
    world.calls.length = 0

    // A re-import is deliberately a NEW history row, so the second run starts from scratch
    // and finds its predecessor's work only through IntegrationMappings.
    const report = await runImport(queuedRun(world).id, worldDeps(world))

    expect(report.counts.room).toEqual({ created: 0, updated: 1, skipped: 0 })
    expect(report.counts.speaker).toEqual({ created: 0, updated: 2, skipped: 0 })
    expect(report.counts.submission).toEqual({ created: 0, updated: 1, skipped: 1 })
    expect(world.calls.filter((call) => call.startsWith('create'))).toEqual([])
    // Nothing new to map, so no mapping row is written a second time either.
    expect(world.mappings).toHaveLength(6)
  })

  it('carries the Needs-email list onto the run row', async () => {
    const world = newWorld()
    const run = queuedRun(world)

    const report = await runImport(run.id, worldDeps(world))

    // The speaker with no address is created, kept, and reported with the local id the
    // organizer needs to open them. No address is invented anywhere along the way.
    expect(report.needsEmail).toEqual([
      { speakerId: 'recSpeaker4', name: 'Ada Lovelace', remoteId: 's1' },
    ])
    expect(world.outcomes.at(0)?.needsEmail).toEqual(report.needsEmail)
    expect(world.runs.get(run.id)?.needsEmail).toHaveLength(1)
  })

  it('still reports Needs-email on the second run, when the speaker still has no address', async () => {
    const world = newWorld()
    await runImport(queuedRun(world).id, worldDeps(world))

    const report = await runImport(queuedRun(world).id, worldDeps(world))

    // Built from every speaker the phase touched, not only the ones it created. A run
    // that reported an empty list here would look like it had solved the problem.
    expect(report.needsEmail).toEqual([
      { speakerId: 'recSpeaker4', name: 'Ada Lovelace', remoteId: 's1' },
    ])
  })

  it('skips the rows bodo authored on the far side, and counts them', async () => {
    const world = newWorld()
    // A mapping written by the PUSH: its requestHash is a real payload hash rather than
    // the import sentinel, so it names a session bodo created at Accelevents.
    world.mappings.push({
      eventId: 'recEvent',
      entityType: 'submission',
      localId: 'recSubOld',
      remoteId: 'accelevents:x1',
      requestHash: 'sha-of-the-payload',
      syncedAt: '2026-08-01T00:00:00.000Z',
    })
    const run = queuedRun(world, { source: 'accelevents', sourceRef: '99:my-event' })

    const report = await runImport(run.id, worldDeps(world, { normalized: acceleventsPayload() }))

    expect(report.counts.submission).toEqual({ created: 0, updated: 0, skipped: 1 })
    expect(world.calls.some((call) => call.startsWith('createSubmission'))).toBe(false)
  })

  it('re-imports what a previous import wrote instead of treating it as bodo output', async () => {
    const world = newWorld()
    // The same row, written by an IMPORT. Without the sentinel the guard would skip it and
    // the second import of an Accelevents event would report an empty run.
    world.mappings.push({
      eventId: 'recEvent',
      entityType: 'submission',
      localId: 'recSubOld',
      remoteId: 'accelevents:x1',
      requestHash: IMPORT_REQUEST_HASH,
      syncedAt: '2026-08-01T00:00:00.000Z',
    })
    const run = queuedRun(world, { source: 'accelevents', sourceRef: '99:my-event' })

    const report = await runImport(run.id, worldDeps(world, { normalized: acceleventsPayload() }))

    expect(report.counts.submission).toEqual({ created: 0, updated: 1, skipped: 0 })
    expect(world.calls).toContain('updateSubmission:recSubOld')
  })

  it('records a failure rather than leaving the run mid-flight', async () => {
    const world = newWorld()
    const run = queuedRun(world)

    const report = await runImport(
      run.id,
      worldDeps(world, { fetch: () => Promise.reject(new Error('sessionize is down')) }),
    )

    expect(report.attempt).toBe('failed')
    expect(world.outcomes.at(0)?.status).toBe('failed')
    expect(world.outcomes.at(0)?.error).toContain('sessionize is down')
  })

  it('still reports the Needs-email list when a later phase fails', async () => {
    const world = newWorld()
    const base = worldDeps(world)

    const report = await runImport(queuedRun(world).id, {
      ...base,
      write: {
        ...base.write,
        // The agenda phase, three phases after the one that built the list.
        scheduleSubmission: () => Promise.reject(new Error('Airtable is unavailable')),
      },
    })

    expect(report.attempt).toBe('failed')
    // Accumulated by the speakers phase and carried through the failure. A run that
    // dropped it would leave the organizer owed a list nothing produces again.
    expect(world.outcomes.at(0)?.needsEmail).toHaveLength(1)
    expect(world.outcomes.at(0)?.status).toBe('failed')
  })

  it('abandons its write when the row has moved on to a fresher holder', async () => {
    const world = newWorld()
    const run = queuedRun(world)

    const report = await runImport(
      run.id,
      worldDeps(world, { heldBy: () => Promise.resolve('worker-2') }),
    )

    // The other worker owns what the row says about itself. Writing progress here would
    // regress a run somebody else may already have finished.
    expect(report.attempt).toBe('fenced')
    expect(world.calls.some((call) => call.startsWith('advance'))).toBe(false)
  })

  it('leaves a terminal run alone', async () => {
    const world = newWorld()
    const run = queuedRun(world, { status: 'done' })

    const report = await runImport(run.id, worldDeps(world))

    expect(report.attempt).toBe('terminal')
    expect(world.calls).toEqual([])
  })
})
