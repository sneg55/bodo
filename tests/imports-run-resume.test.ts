// What survives a run being interrupted, fenced, or run again over the same event.
//
// Split from tests/imports-run.test.ts, which pins the happy path and the dependency
// order. Everything here is about the seams between invocations, because `maxPhases: 1`
// makes every real import several invocations and each of these was a defect found by
// review rather than a hypothetical:
//
//   - a re-import that gained a speaker never updated its cast;
//   - a phase interrupted before its end left every record it had created unmapped, so the
//     resumed run created all of them a second time, and the batch that replaced it still
//     lost every record after the tenth;
//   - a worker whose lease lapsed during the far-side read wrote a whole phase anyway.
//
// The Needs-email list has its own file, tests/imports-needs-email.test.ts, because three
// separate defects have hit it. The fake world is tests/helpers/imports-world.ts.

import { describe, expect, it } from 'vitest'
import type { NormalizedImport } from '@/features/imports/normalize'
import { runImport } from '@/features/imports/run'
import { NORMALIZED, newWorld, queuedRun, worldDeps } from '../tests/helpers/imports-world'

/** The same programme with a co-speaker added to the session, as a re-import would see. */
function withThirdSpeaker(): NormalizedImport {
  return {
    ...NORMALIZED,
    speakers: [
      ...NORMALIZED.speakers,
      { remoteId: 's3', email: 'kay@example.com', firstName: 'Kay', lastName: 'J', links: {} },
    ],
    submissions: NORMALIZED.submissions.map((submission) => ({
      ...submission,
      participants: [
        ...submission.participants,
        { speakerRemoteId: 's3', role: 'co_speaker' as const, isPrimary: false, sortOrder: 2 },
      ],
    })),
  }
}

describe('a re-import whose remote session gained a speaker', () => {
  it('adds the missing participant row and leaves the rest alone', async () => {
    const world = newWorld()
    await runImport(queuedRun(world).id, worldDeps(world))
    const created = [...world.cast.values()].at(0) ?? []
    world.calls.length = 0

    await runImport(queuedRun(world).id, worldDeps(world, { normalized: withThirdSpeaker() }))

    // One row written, for the speaker who was not there before. The update branch used
    // to `continue` before the cast was even built, so the roster never changed again.
    expect(world.calls).toContain('addParticipants:recSub6:1')
    expect([...world.cast.values()].at(0)).toEqual([...created, 'recSpeaker7'])
  })

  it('writes no participant row at all when the cast is unchanged', async () => {
    const world = newWorld()
    await runImport(queuedRun(world).id, worldDeps(world))
    world.calls.length = 0

    await runImport(queuedRun(world).id, worldDeps(world))

    // Additive means additive: the same cast twice is one set of rows, not two.
    expect(world.calls).toContain('addParticipants:recSub6:0')
    expect([...world.cast.values()].at(0)).toHaveLength(2)
  })

  it('never deletes the row of a speaker the source dropped', async () => {
    const world = newWorld()
    await runImport(queuedRun(world).id, worldDeps(world, { normalized: withThirdSpeaker() }))

    // §5.0e: a re-run "updates what it created before and creates what is new; it never
    // deletes". bodo cannot tell a speaker removed upstream from one an organizer added
    // here by hand, so the row stays and the roster is a superset.
    await runImport(queuedRun(world).id, worldDeps(world))

    expect([...world.cast.values()].at(0)).toHaveLength(3)
  })
})

describe('a phase interrupted before it finished', () => {
  it('has already written the mappings for the records it created', async () => {
    const world = newWorld()
    // Twelve lookups, so the ledger crosses its ten-row batch, and the thirteenth write
    // fails the way a Worker CPU limit or a 429 ends a phase.
    const tracks = Array.from({ length: 12 }, (_, at) => ({
      remoteId: `t${String(at)}`,
      name: `Track ${String(at)}`,
    }))
    const base = worldDeps(world, { normalized: { ...NORMALIZED, rooms: [], tags: [], tracks } })
    let made = 0

    await runImport(queuedRun(world).id, {
      ...base,
      write: {
        ...base.write,
        createLookup: async (draft) => {
          made += 1
          if (made > 11) throw new Error('Airtable is unavailable')
          return await base.write.createLookup(draft)
        },
      },
    })

    // ELEVEN, one per track created, and the eleventh is the whole point of this round.
    //
    // The first version held every mapping to the end of the phase, so an interruption
    // anywhere inside it lost all eleven. The second wrote at every tenth pending row,
    // which saved tracks 1 to 10 and left track 11 in an isolate that is now gone: the
    // resumed run found no mapping for it and created a twelfth track with the same name.
    // A lookup has no natural key, so nothing else would ever have caught it.
    expect(world.mappings).toHaveLength(11)
    expect(world.calls.filter((call) => call === 'saveMappings:1')).toHaveLength(11)
    expect(world.calls).not.toContain('saveMappings:10')
  })

  it('costs one extra request per record, and only for the entities that need it', async () => {
    const world = newWorld()
    // Ten addressed speakers, so the old batch would have fired exactly once at the tenth.
    const speakers = Array.from({ length: 10 }, (_, at) => ({
      remoteId: `s${String(at)}`,
      email: `speaker${String(at)}@example.com`,
      firstName: `Speaker ${String(at)}`,
      lastName: '',
      links: {},
    }))
    const normalized = { ...NORMALIZED, rooms: [], tags: [], tracks: [], speakers }

    await runImport(queuedRun(world).id, worldDeps(world, { normalized, maxPhases: 2 }))

    // One request for ten mappings, not ten. `upsertSpeakerByEmail` matches on the email
    // column, so a mapping lost here costs the resumed run a lookup rather than a duplicate
    // row, and that is the only class where the batch is still worth its window.
    expect(world.calls.filter((call) => call.startsWith('saveMappings'))).toEqual([
      'saveMappings:10',
    ])
  })

  it('creates only what the interrupted attempt had not mapped yet', async () => {
    const world = newWorld()
    const speakers = Array.from({ length: 12 }, (_, at) => ({
      remoteId: `s${String(at)}`,
      // No address, so `upsertSpeakerByEmail` cannot dedupe them either: the mapping row
      // is the only thing standing between an interruption and twelve duplicate speakers.
      email: '',
      firstName: `Speaker ${String(at)}`,
      lastName: '',
      links: {},
    }))
    const normalized = { ...NORMALIZED, rooms: [], tags: [], tracks: [], speakers }
    const base = worldDeps(world, { normalized, maxPhases: 2 })
    let made = 0

    await runImport(queuedRun(world).id, {
      ...base,
      write: {
        ...base.write,
        createSpeaker: async (draft) => {
          made += 1
          if (made > 11) throw new Error('Airtable is unavailable')
          return await base.write.createSpeaker(draft)
        },
      },
    })
    world.calls.length = 0
    await runImport(queuedRun(world).id, worldDeps(world, { normalized, maxPhases: 2 }))

    // ONE create, not two and not twelve. The eleven the interrupted attempt landed all
    // carry a mapping now, so they come back as updates; only the twelfth, whose create
    // threw, is still missing. Under the ten-row batch the eleventh speaker was created
    // with no mapping and this run created her a second time, and because she has no
    // address there was no email column for `upsertSpeakerByEmail` to collide on: the
    // duplicate was silent and permanent.
    expect(world.calls.filter((call) => call.startsWith('createSpeaker'))).toHaveLength(1)
    expect(world.calls.filter((call) => call.startsWith('updateSpeaker'))).toHaveLength(11)
  })
})

describe('a worker whose lease lapsed while it was reading the far side', () => {
  it('writes nothing, rather than discovering it at the end of the phase', async () => {
    const world = newWorld()
    const run = queuedRun(world)

    const report = await runImport(
      run.id,
      worldDeps(world, { heldBy: () => Promise.resolve('worker-2') }),
    )

    expect(report.attempt).toBe('fenced')
    // The holder is checked before the phase as well as after it. Without the first check
    // this worker created every lookup in the metadata phase over the top of whatever
    // worker-2 had already done, and only then noticed.
    expect(world.calls).toEqual([])
  })
})
