// The claim logic is the whole reason ClaimGuard exists, so it is tested
// directly against a fake storage rather than through a Worker. What is being
// asserted is the property KV could not give us: a second claimant loses.
//
// The release is tested to the same depth, because a lease anybody can drop is
// not a lease: the wrong-holder no-op is the safety property, and it is the one
// thing no caller can check for itself.

import { describe, expect, it } from 'vitest'

import { ClaimGuard } from '@/services/guard/claim-guard'

function fakeState() {
  const map = new Map<string, unknown>()
  const alarms: number[] = []
  return {
    map,
    alarms,
    storage: {
      get: <T>(key: string) => Promise.resolve(map.get(key) as T | undefined),
      put: <T>(key: string, value: T) => {
        map.set(key, value)
        return Promise.resolve()
      },
      delete: (key: string) => Promise.resolve(map.delete(key)),
      deleteAll: () => {
        map.clear()
        return Promise.resolve()
      },
      setAlarm: (at: number) => {
        alarms.push(at)
        return Promise.resolve()
      },
    },
  }
}

const T0 = 1_754_600_000_000 // fixed epoch ms; nothing here reads the clock

describe('ClaimGuard.claim', () => {
  it('grants a first claim', async () => {
    const guard = new ClaimGuard(fakeState())
    expect(await guard.claim({ holder: 'req-1', ttlMs: 60_000 }, T0)).toEqual({ granted: true })
  })

  it('denies a second holder while the claim is live', async () => {
    const guard = new ClaimGuard(fakeState())
    await guard.claim({ holder: 'req-1', ttlMs: 60_000 }, T0)

    const second = await guard.claim({ holder: 'req-2', ttlMs: 60_000 }, T0 + 1)

    expect(second.granted).toBe(false)
    expect(second.heldBy).toBe('req-1')
    expect(second.expiresAt).toBe(T0 + 60_000)
  })

  it('is idempotent for the same holder, so a retried send does not deadlock', async () => {
    const guard = new ClaimGuard(fakeState())
    await guard.claim({ holder: 'run-7', ttlMs: 30_000 }, T0)

    expect(await guard.claim({ holder: 'run-7', ttlMs: 30_000 }, T0 + 5_000)).toEqual({
      granted: true,
    })
  })

  it('re-grants to a new holder once the lease has expired', async () => {
    const guard = new ClaimGuard(fakeState())
    await guard.claim({ holder: 'run-1', ttlMs: 10_000 }, T0)

    // A crashed sender's lease lapses; the next cron invocation may take the row.
    expect(await guard.claim({ holder: 'run-2', ttlMs: 10_000 }, T0 + 10_001)).toEqual({
      granted: true,
    })
  })

  it('pins the expiry boundary as exclusive, so the rule is not ambiguous', async () => {
    const guard = new ClaimGuard(fakeState())
    await guard.claim({ holder: 'run-1', ttlMs: 10_000 }, T0)

    // At exactly expiresAt the lease is over. Safe for both callers: a jti's
    // record outlives nothing, because the JWT itself is invalid by then.
    expect((await guard.claim({ holder: 'run-2', ttlMs: 10_000 }, T0 + 10_000)).granted).toBe(true)
    expect((await guard.claim({ holder: 'run-3', ttlMs: 10_000 }, T0 + 9_999)).granted).toBe(false)
  })

  it('schedules self-cleanup past the expiry so consumed jti rows do not pile up', async () => {
    const state = fakeState()
    const guard = new ClaimGuard(state)

    await guard.claim({ holder: 'jti-abc', ttlMs: 900_000 }, T0)

    expect(state.alarms).toHaveLength(1)
    expect(state.alarms[0]).toBeGreaterThan(T0 + 900_000)
  })

  it('clears storage on alarm', async () => {
    const state = fakeState()
    const guard = new ClaimGuard(state)
    await guard.claim({ holder: 'jti-abc', ttlMs: 1_000 }, T0)

    await guard.alarm()

    expect(state.map.size).toBe(0)
  })
})

describe('ClaimGuard.release', () => {
  it('drops a claim the caller holds, so the key is free before the lease is up', async () => {
    const state = fakeState()
    const guard = new ClaimGuard(state)
    await guard.claim({ holder: 'tick-1', ttlMs: 840_000 }, T0)

    expect(await guard.release({ holder: 'tick-1' })).toEqual({ released: true })
    expect(state.map.size).toBe(0)
  })

  it('refuses a release from a different holder, which is the whole safety property', async () => {
    // A lease anybody can drop is not a lease. The loser of a claim knows the key by
    // construction, so nothing but the holder check stops it cancelling the winner's work.
    const state = fakeState()
    const guard = new ClaimGuard(state)
    await guard.claim({ holder: 'tick-1', ttlMs: 840_000 }, T0)

    const released = await guard.release({ holder: 'tick-2' })

    expect(released.released).toBe(false)
    expect(released.heldBy).toBe('tick-1')
    // Still held, so the winner keeps scoring under a claim nobody took from it.
    expect((await guard.claim({ holder: 'tick-2', ttlMs: 1_000 }, T0 + 1)).granted).toBe(false)
  })

  it('reports that it released nothing when the key is not claimed at all', async () => {
    const guard = new ClaimGuard(fakeState())

    expect(await guard.release({ holder: 'tick-1' })).toEqual({ released: false })
  })

  it('lets the next attempt take the key immediately instead of waiting out the lease', async () => {
    // The reason the route exists: a job that fails fast held its key for the full
    // fourteen minute lease, so three attempts took most of an hour.
    const guard = new ClaimGuard(fakeState())
    await guard.claim({ holder: 'tick-1', ttlMs: 840_000 }, T0)

    await guard.release({ holder: 'tick-1' })

    expect(await guard.claim({ holder: 'tick-2', ttlMs: 840_000 }, T0 + 1_000)).toEqual({
      granted: true,
    })
  })

  it('releases only the holder that owns the key now, not the one that owned it before', async () => {
    // A crashed tick's lease lapses and the next tick takes the key. If the first one
    // then comes back to life, its release must not drop a claim it no longer owns.
    const guard = new ClaimGuard(fakeState())
    await guard.claim({ holder: 'tick-1', ttlMs: 10_000 }, T0)
    await guard.claim({ holder: 'tick-2', ttlMs: 10_000 }, T0 + 10_001)

    expect(await guard.release({ holder: 'tick-1' })).toEqual({
      released: false,
      heldBy: 'tick-2',
    })
  })
})

describe('the ClaimGuard routes', () => {
  function post(path: string, body: unknown): Request {
    return new Request(`https://claim-guard.internal${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('answers /release the same shape /claim answers', async () => {
    const guard = new ClaimGuard(fakeState())
    await guard.fetch(post('/claim', { holder: 'tick-1', ttlMs: 840_000 }))

    const response = await guard.fetch(post('/release', { holder: 'tick-1' }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ released: true })
  })

  it('keeps 404 for an unknown path and 405 for anything but POST', async () => {
    const guard = new ClaimGuard(fakeState())

    expect((await guard.fetch(post('/renew', { holder: 'tick-1' }))).status).toBe(404)
    expect((await guard.fetch(new Request('https://claim-guard.internal/release'))).status).toBe(
      405,
    )
  })
})
