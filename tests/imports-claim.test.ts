// Claiming, and what the sweep does with a run it cannot have.
//
// This is the property the whole run design rests on. Airtable has no transaction and no
// compare-and-swap, so two overlapping cron invocations both read the same `queued` row,
// both write `running`, and both import the event: every session twice, every speaker
// twice, and an `IntegrationMappings` table with two rows per entity. The status columns
// cannot prevent that and are not trying to. `claimOnce`, backed by the ClaimGuard Durable
// Object and keyed `import:<runId>`, is the lock, and it is the only one.
//
// The fake below reproduces the two properties of `claimOnce` that matter: it grants a key
// to one holder, and it RE-GRANTS to that same holder, which is why a holder has to be
// unique per invocation rather than derived from anything stable.

import { describe, expect, it } from 'vitest'

import { AppError, ErrorIds } from '@/constants/errorIds'
import { IMPORT_LEASE_MS, runImport } from '@/features/imports/run'
import { sweepImportRuns } from '@/features/imports/sweep'
import { newWorld, queuedRun, type World, worldDeps } from '../tests/helpers/imports-world'

function claimRegistry(): {
  claim: (key: string, holder: string, ttlMs: number) => Promise<{ granted: boolean }>
  ttls: number[]
} {
  const held = new Map<string, string>()
  const ttls: number[] = []
  return {
    claim: (key, holder, ttlMs) => {
      ttls.push(ttlMs)
      const owner = held.get(key)
      // Re-granting to the same holder is deliberate in the real thing: a retry must not
      // deadlock against its own earlier lease.
      if (owner === undefined || owner === holder) {
        held.set(key, holder)
        return Promise.resolve({ granted: true })
      }
      return Promise.resolve({ granted: false })
    },
    ttls,
  }
}

function sweepDeps(world: World, holder: string, registry: ReturnType<typeof claimRegistry>) {
  const snapshot = [...world.runs.values()]
  return {
    ...worldDeps(world, { claim: registry.claim, holder }),
    // A snapshot taken before either sweep starts, which is exactly the state two
    // overlapping invocations read: the row is queued as far as both of them know.
    listDue: () => Promise.resolve(snapshot),
  }
}

describe('import claiming', () => {
  it('processes a run once when two sweeps overlap', async () => {
    const world = newWorld()
    queuedRun(world)
    const registry = claimRegistry()

    const [first, second] = await Promise.all([
      sweepImportRuns(sweepDeps(world, 'worker-a', registry)),
      sweepImportRuns(sweepDeps(world, 'worker-b', registry)),
    ])

    // One sweep did the work; the other found the run held and left it alone.
    expect(first.done + second.done).toBe(1)
    expect(first.contended + second.contended).toBe(1)
    // The proof that matters is in the writes, not the counters: one submission, one
    // cast, one mapping row per entity.
    expect(world.calls.filter((call) => call.startsWith('createSubmission'))).toHaveLength(1)
    expect(world.calls.filter((call) => call.startsWith('createSpeaker'))).toHaveLength(1)
    expect(world.mappings).toHaveLength(6)
  })

  it('holds the run for less than the schedule it is swept on', async () => {
    const world = newWorld()
    queuedRun(world)
    const registry = claimRegistry()

    await sweepImportRuns(sweepDeps(world, 'worker-a', registry))

    // A lease longer than the sweep interval would stop a dead run ever being resumed;
    // a lease shorter than one phase would hand a live run to a second worker.
    expect(registry.ttls).toEqual([IMPORT_LEASE_MS])
  })

  it('re-grants to the same holder, so one worker can resume its own run', async () => {
    const world = newWorld()
    const run = queuedRun(world)
    const registry = claimRegistry()
    const deps = { ...worldDeps(world, { claim: registry.claim, maxPhases: 1 }) }

    const first = await runImport(run.id, deps)
    const second = await runImport(run.id, deps)

    expect(first.phases).toEqual(['metadata'])
    expect(second.phases).toEqual(['speakers'])
  })

  it('counts a run it holds no client for as skipped, and leaves the row alone', async () => {
    const world = newWorld()
    const run = queuedRun(world, { source: 'sessionboard', sourceRef: 'us:1234' })
    const registry = claimRegistry()

    const result = await sweepImportRuns({
      ...sweepDeps(world, 'worker-a', registry),
      // What `fetchSource` raises when the caller supplied no client for the source. A
      // cron sweep holds no Sessionboard token, because there is no credential column.
      fetch: () =>
        Promise.reject(new AppError(ErrorIds.CFG_ENV_MISSING, 'no sessionboard client', {})),
    })

    expect(result.skipped).toBe(1)
    expect(result.failed).toBe(0)
    // Not burned to `failed`: a caller that does hold the token can still pick it up, and
    // `dueImportRuns` hands back a `running` row once its lease lapses.
    expect(world.runs.get(run.id)?.status).toBe('running')
    expect(world.outcomes).toEqual([])
  })

  it('reports a run that is not finished as advanced rather than done', async () => {
    const world = newWorld()
    queuedRun(world)
    const registry = claimRegistry()

    const result = await sweepImportRuns({
      ...sweepDeps(world, 'worker-a', registry),
      maxPhases: 1,
    })

    expect(result).toEqual({
      found: 1,
      advanced: 1,
      done: 0,
      failed: 0,
      contended: 0,
      skipped: 0,
    })
  })

  it('skips a run that has already finished', async () => {
    const world = newWorld()
    queuedRun(world, { status: 'done' })
    const registry = claimRegistry()

    const result = await sweepImportRuns(sweepDeps(world, 'worker-a', registry))

    expect(result.skipped).toBe(1)
    expect(world.calls).toEqual([])
  })
})
