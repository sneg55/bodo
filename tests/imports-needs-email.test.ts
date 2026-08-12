// The Needs-email list: §5.0e's stated deliverable for a Sessionize import, and the one
// thing an import produces that nothing else in the product can produce again.
//
// Split out of tests/imports-run-resume.test.ts, which pins the seams between invocations
// generally. This file is only about the list, because three separate defects have now hit
// it and each was a different way of answering the wrong question:
//
//   - it was lost the moment a run spanned two invocations, since the checkpoint persists
//     phase and counts only;
//   - it was still lost when a LATER phase failed, because the outcome-time rebuild covered
//     the success path alone;
//   - it was derived from the SOURCE, so a far side that gained an address for somebody the
//     run had already imported without one made the run report an empty list while that
//     speaker sat in bodo with nowhere to send a magic link.
//
// The fake world is tests/helpers/imports-world.ts, and its `speakers` map is what stands
// in for bodo's own rows.

import { describe, expect, it } from 'vitest'
import type { NormalizedImport } from '@/features/imports/normalize'
import { runImport } from '@/features/imports/run'
import { NORMALIZED, newWorld, queuedRun, worldDeps } from '../tests/helpers/imports-world'

/** The same programme after the far side finally supplied the address it was missing. */
function adaAddressed(): NormalizedImport {
  return {
    ...NORMALIZED,
    speakers: NORMALIZED.speakers.map((speaker) =>
      speaker.remoteId === 's1' ? { ...speaker, email: 'ada@example.com' } : speaker,
    ),
    // The mappers build this list off the same field, so a source that now has an address
    // for Ada stops naming her here as well. That is precisely what the derivation used to
    // read, and why it went quiet about a speaker bodo still cannot contact.
    needsEmail: [],
  }
}

/** Ada, as bodo holds her: created by the speakers phase with a blank address. */
const ADA_OWED = { speakerId: 'recSpeaker4', name: 'Ada Lovelace', remoteId: 's1' }

describe('the Needs-email list is a claim about bodo, not about the source', () => {
  it('still names the speaker after the far side gains an address for her', async () => {
    const world = newWorld()
    const run = queuedRun(world)
    const steps = (normalized: NormalizedImport) => worldDeps(world, { maxPhases: 1, normalized })
    // Two invocations: metadata, then speakers. Ada lands with a blank address.
    await runImport(run.id, steps(NORMALIZED))
    await runImport(run.id, steps(NORMALIZED))
    expect(world.speakers.get(ADA_OWED.speakerId)?.email).toBe('')

    // The source gains her address between invocations. The speakers phase is behind us,
    // so nothing writes it to her local row, and a magic link still has nowhere to go.
    let report = await runImport(run.id, steps(adaAddressed()))
    while (report.attempt === 'advanced') report = await runImport(run.id, steps(adaAddressed()))

    expect(report.attempt).toBe('done')
    // Derived from the source, this was `[]`, and the organizer was told the import owed
    // them nothing while Ada sat in bodo with no address.
    expect(report.needsEmail).toEqual([ADA_OWED])
    expect(world.outcomes.at(0)?.needsEmail).toEqual([ADA_OWED])
  })

  it('drops the speaker once her LOCAL row has an address', async () => {
    const world = newWorld()
    const run = queuedRun(world)
    const deps = worldDeps(world, { maxPhases: 1 })
    await runImport(run.id, deps)
    await runImport(run.id, deps)

    // An organizer types her address in while the run is still going.
    world.speakers.set(ADA_OWED.speakerId, {
      id: ADA_OWED.speakerId,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    })
    let report = await runImport(run.id, deps)
    while (report.attempt === 'advanced') report = await runImport(run.id, deps)

    // Empty is a real answer once the speakers phase has run, so it is written as `[]`
    // rather than withheld: the debt is settled, and the row has to be able to say so.
    expect(report.needsEmail).toEqual([])
    expect(world.outcomes.at(0)?.needsEmail).toEqual([])
  })
})

describe('a run that fails after its speakers phase', () => {
  it('still owes the organizer the Needs-email list, and writes it', async () => {
    const world = newWorld()
    const run = queuedRun(world)
    const deps = worldDeps(world, { maxPhases: 1 })
    await runImport(run.id, deps)
    await runImport(run.id, deps)

    // The submissions phase throws in an invocation whose own `held.needsEmail` was seeded
    // `[]` off the row, because the checkpoint persists phase and counts only.
    const report = await runImport(run.id, {
      ...deps,
      write: {
        ...deps.write,
        createSubmission: () => Promise.reject(new Error('Airtable is unavailable')),
      },
    })

    expect(report.attempt).toBe('failed')
    // The list used to be lost here entirely: the row was written failed with a blank
    // cell, and nothing ever produced the list again.
    expect(report.needsEmail).toEqual([ADA_OWED])
    expect(world.outcomes.at(0)?.status).toBe('failed')
    expect(world.outcomes.at(0)?.needsEmail).toEqual([ADA_OWED])
  })

  it('writes no list when it failed before ever looking for addresses', async () => {
    const world = newWorld()
    const run = queuedRun(world)

    const report = await runImport(
      run.id,
      worldDeps(world, {
        write: {
          ...worldDeps(world).write,
          createLookup: () => Promise.reject(new Error('Airtable is unavailable')),
        },
      }),
    )

    expect(report.attempt).toBe('failed')
    // Absent, not `[]`. This run never reached the speakers phase, so it has not looked,
    // and an empty list would claim it looked and found nobody.
    expect(world.outcomes.at(0)?.needsEmail).toBeUndefined()
  })
})

describe('the Needs-email list across invocations', () => {
  it('reaches the finished row when the run took four invocations to get there', async () => {
    const world = newWorld()
    const run = queuedRun(world)

    const deps = worldDeps(world, { maxPhases: 1 })
    let report = await runImport(run.id, deps)
    while (report.attempt === 'advanced') report = await runImport(run.id, deps)

    expect(report.attempt).toBe('done')
    // The defect: the checkpoint persists phase and counts only, so the invocation that
    // finished the run reloaded an empty list and wrote it. A Sessionize import that
    // reports nobody needs an address is the worst outcome §5.0e names.
    expect(report.needsEmail).toEqual([ADA_OWED])
    expect(world.outcomes.at(0)?.needsEmail).toEqual(report.needsEmail)
  })

  it('is still right when a later invocation resumes a run it did not start', async () => {
    const world = newWorld()
    const run = queuedRun(world)
    // Two invocations get through metadata and speakers, then a different worker takes it.
    await runImport(run.id, worldDeps(world, { maxPhases: 2 }))

    const report = await runImport(run.id, worldDeps(world, { holder: 'worker-2' }))

    expect(report.attempt).toBe('done')
    expect(report.needsEmail).toHaveLength(1)
  })
})
