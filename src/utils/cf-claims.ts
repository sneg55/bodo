// Claiming a key exactly once, and handing it back.
//
// The pair sits beside cf.ts rather than inside it because it is one protocol with two
// routes and one set of failure decisions, while cf.ts is the capability boundary for the
// other bindings. Callers still import from `@/utils/cf`, which re-exports both, so
// nothing outside this boundary knows the split exists.
//
// The stand-in below is gated on DEPLOY_ENV and never on "did the binding happen to be
// there", for the reason cf.ts gives: a Map is per isolate, so two isolates would both
// grant the same claim.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getBindings } from '@/utils/cf-bindings'
import { isLocalDeploy } from '@/utils/env'

function nowMs(): number {
  return new Date().getTime()
}

/** In-process stand-in for the guard, used only on a developer's machine. */
const memoryClaims = new Map<string, { holder: string; expiresAt: number }>()

/**
 * Local dev only. Single-process, so a Map is genuinely atomic here; on Workers it
 * would not be, which is why the real path is a Durable Object.
 */
function claimInMemory(
  key: string,
  holder: string,
  ttlMs: number,
): { granted: boolean; heldBy?: string } {
  const existing = memoryClaims.get(key)
  if (existing !== undefined && existing.expiresAt > nowMs()) {
    if (existing.holder === holder) return { granted: true }
    return { granted: false, heldBy: existing.holder }
  }
  memoryClaims.set(key, { holder, expiresAt: nowMs() + ttlMs })
  return { granted: true }
}

/** The release half of the stand-in, with the same holder check the guard makes. */
function releaseInMemory(key: string, holder: string): { released: boolean; heldBy?: string } {
  const existing = memoryClaims.get(key)
  if (existing === undefined) return { released: false }
  if (existing.holder !== holder) return { released: false, heldBy: existing.holder }
  memoryClaims.delete(key)
  return { released: true }
}

/**
 * Claim a key exactly once, atomically. Returns true only for the winner.
 *
 * Used for magic-link `jti` consumption and for leasing an EmailOutbox row
 * before sending. Both need compare-and-swap, which neither KV (eventually
 * consistent, no atomic ops) nor Airtable (no transaction, no CAS) provides.
 * The work happens in the ClaimGuard Durable Object, one DO id per key, so
 * requests for a given key are serialized by the platform.
 *
 * A repeat claim by the SAME holder returns true, so a retry does not deadlock
 * against its own earlier lease.
 *
 * There is no fallback outside local dev. A Map is per isolate, so two isolates
 * would both grant the same claim: the magic link becomes multi-use and two
 * outbox workers send the same email. That is the exact failure the DO exists to
 * prevent, so a broken guard is a hard config error rather than a quiet downgrade,
 * and the caller sees a login that fails instead of one that leaks.
 *
 * Under `next dev` the binding EXISTS but the class behind it does not, because
 * `initOpenNextCloudflareForDev()` binds the namespace while wrangler warns that
 * "no such Durable Object class is exported from the worker". So detecting local
 * dev by an absent binding was never enough: every call reached the stub and threw,
 * which made signing in under `next dev` return a 500. Local dev therefore falls
 * back on a FAILED call as well as on a missing one, and says so in the log.
 */
export async function claimOnce(
  key: string,
  holder: string,
  ttlMs: number,
): Promise<{ granted: boolean; heldBy?: string }> {
  const env = await getBindings()
  const namespace = env.BODO_CLAIM_GUARD

  if (namespace === undefined) {
    if (!isLocalDeploy()) {
      throw new AppError(
        ErrorIds.CFG_BINDING_MISSING,
        'BODO_CLAIM_GUARD is not bound, so claims cannot be made atomically; check the durable_objects binding in wrangler.jsonc',
        { binding: 'BODO_CLAIM_GUARD', key },
      )
    }
    return claimInMemory(key, holder, ttlMs)
  }

  const stub = namespace.get(namespace.idFromName(key))

  let response: Response
  try {
    // A URL string plus init, NOT `new Request(...)`. Both are valid against a real
    // stub, but the `next dev` binding proxy stringifies its first argument, so a
    // Request arrived as the literal "[object Request]" and threw `Invalid URL`
    // before the call left the process. The string form crosses that proxy intact.
    response = await stub.fetch('https://claim-guard.internal/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ holder, ttlMs }),
    })
  } catch (error) {
    if (!isLocalDeploy()) {
      throw new AppError(ErrorIds.CFG_BINDING_FAILED, 'claim guard could not be reached', {
        key,
        cause: String(error),
      })
    }
    console.warn(
      `[claim-guard] unreachable locally, using the in-memory guard for "${key}": ${String(error)}`,
    )
    return claimInMemory(key, holder, ttlMs)
  }

  if (!response.ok) {
    // Not CFG_BINDING_MISSING: the binding is present and it answered. A 404, 405,
    // or 500 from the Durable Object is a runtime fault, and sharing an id with the
    // missing-binding case would make the two indistinguishable in wrangler tail.
    if (isLocalDeploy()) {
      console.warn(
        `[claim-guard] answered ${response.status} locally, using the in-memory guard for "${key}"`,
      )
      return claimInMemory(key, holder, ttlMs)
    }
    throw new AppError(ErrorIds.CFG_BINDING_FAILED, 'claim guard rejected the request', {
      status: response.status,
      key,
    })
  }
  // Same last step, same gap, opposite policy. A verdict that cannot be read is not a
  // verdict, so this one still stops the caller, which is what a bare `.json()` throw did
  // anyway. What it did not do is arrive with an id: it escaped as a SyntaxError, so the
  // one failure a claim can suffer that says nothing in `wrangler tail` was this one.
  try {
    const claimed: { granted: boolean; heldBy?: string } = await response.json()
    return claimed
  } catch (error) {
    if (isLocalDeploy()) {
      console.warn(`[claim-guard] answered with an unreadable body locally for "${key}"`)
      return claimInMemory(key, holder, ttlMs)
    }
    throw new AppError(
      ErrorIds.CFG_BINDING_FAILED,
      'claim guard answered with an unreadable body',
      {
        key,
        cause: String(error),
      },
    )
  }
}

/**
 * Hand a claimed key back before its lease is up. Only the holder can.
 *
 * The mirror of `claimOnce`, and it exists because the lease is sized for the worst case
 * while almost every run is the ordinary one. `PRESCREEN_LEASE_MS` has to outlast a
 * worst-case model call plus six Airtable calls, roughly fourteen minutes; a job the model
 * refuses fails in a second and, with no release, kept its key for the remaining fourteen.
 * The next attempt then waited out a lease nobody was using, and three attempts took most
 * of an hour. Same story for the enqueue, where an organizer who assigns more reviewers
 * and presses again is told the round is already being queued when it finished minutes ago.
 *
 * **It reports where `claimOnce` throws, and that asymmetry is the decision.** A claim that
 * cannot be made must stop the caller: proceeding on a per-isolate Map is the multi-use
 * magic link and the double-scored abstract the DO exists to prevent, so there is nothing
 * safe to return. A release that cannot be made is bookkeeping AFTER the work is done and
 * written: the only consequence is that the lease expires by itself, which is exactly
 * where this code stood before the release existed. Throwing would be strictly worse than
 * that, because it would fail a cron tick, or an organizer's action, over work that had
 * already succeeded, and every call site would have to guard against an error it could do
 * nothing about. So a failure is logged with the same two error ids `claimOnce` throws,
 * which keeps it greppable in `wrangler tail`, and `{ released: false }` is returned.
 *
 * The local fallback is `claimOnce`'s, for `claimOnce`'s reason: under `next dev` the
 * binding exists while the class behind it does not, so local dev stands in on a FAILED
 * call as well as on a missing one.
 */
export async function releaseClaim(
  key: string,
  holder: string,
): Promise<{ released: boolean; heldBy?: string }> {
  const env = await getBindings()
  const namespace = env.BODO_CLAIM_GUARD

  if (namespace === undefined) {
    if (!isLocalDeploy()) {
      console.error(
        `[${ErrorIds.CFG_BINDING_MISSING}] BODO_CLAIM_GUARD is not bound, so "${key}" is held until its lease expires`,
      )
      return { released: false }
    }
    return releaseInMemory(key, holder)
  }

  const stub = namespace.get(namespace.idFromName(key))

  let response: Response
  try {
    // A URL string plus init, NOT `new Request(...)`, for the reason `claimOnce` gives:
    // the `next dev` binding proxy stringifies its first argument, so a Request arrives
    // as the literal "[object Request]" and throws `Invalid URL` before the call leaves
    // the process.
    response = await stub.fetch('https://claim-guard.internal/release', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ holder }),
    })
  } catch (error) {
    if (!isLocalDeploy()) {
      console.error(
        `[${ErrorIds.CFG_BINDING_FAILED}] claim guard could not be reached to release "${key}": ${String(error)}`,
      )
      return { released: false }
    }
    console.warn(
      `[claim-guard] unreachable locally, releasing in the in-memory guard for "${key}": ${String(error)}`,
    )
    return releaseInMemory(key, holder)
  }

  if (!response.ok) {
    // The binding is present and it answered, so this is a runtime fault rather than a
    // deploy configured wrong: the same distinction `claimOnce` makes between the two ids.
    if (isLocalDeploy()) {
      console.warn(
        `[claim-guard] answered ${response.status} locally, releasing in the in-memory guard for "${key}"`,
      )
      return releaseInMemory(key, holder)
    }
    console.error(
      `[${ErrorIds.CFG_BINDING_FAILED}] claim guard answered ${response.status} releasing "${key}"`,
    )
    return { released: false }
  }
  // Inside the policy, not outside it. Reading the body is the last thing that can fail and
  // it was the one step left uncaught, so a 200 carrying a proxy's error page threw out of
  // a function whose whole contract is that it does not. That reached the enqueue, which
  // awaits this after its writes have landed, and turned a round that WAS queued into an
  // error the organizer would press through again.
  try {
    const released: { released: boolean; heldBy?: string } = await response.json()
    return released
  } catch (error) {
    if (isLocalDeploy()) {
      console.warn(`[claim-guard] answered with an unreadable body locally for "${key}"`)
      return releaseInMemory(key, holder)
    }
    console.error(
      `[${ErrorIds.CFG_BINDING_FAILED}] claim guard answered releasing "${key}" with a body that could not be read: ${String(error)}`,
    )
    return { released: false }
  }
}
