// ClaimGuard: a Durable Object that answers exactly one question atomically.
// "Am I the first to claim this key?"
//
// Two callers need that, and neither of the obvious stores can provide it:
//
//   1. Magic-link single use (BUILD_SPEC section 4). The `jti` denylist used to
//      live in Workers KV. KV is eventually consistent and has no atomic
//      read-modify-write, so two requests carrying the same link can both read
//      "not used" and both mint a session. A single-use token that is sometimes
//      double-use is not single-use. (Codex review finding 6.)
//
//   2. EmailOutbox claiming (BUILD_SPEC section 5.3). Airtable has no
//      transaction and no compare-and-swap, so "read queued rows, mark sending,
//      send" can send twice when two cron invocations overlap, or drop mail if
//      the row is marked before the provider accepts it. (Codex review finding 5.)
//
// Why a Durable Object is enough: requests to one DO id are serialized, so
// read-then-write inside a single handler cannot interleave. The id is derived
// from the claim key itself (`idFromName`), which means every key gets its own
// serialization domain and there is no shared hot object.
//
// Idempotency, not just mutual exclusion: a claim that has already been granted
// to the SAME holder returns `granted: true` again, so a retried send does not
// deadlock against its own earlier lease. A claim held by a DIFFERENT holder
// returns `granted: false` until the lease expires.
//
// Release, because a lease sized for a crash is paid by every ordinary run. The
// pre-screen lease has to outlast a worst-case model call plus six Airtable calls,
// roughly fourteen minutes, and a job the model refuses fails in a second: without a
// release that key is held for the rest of the lease, so its next attempt waits
// fourteen minutes instead of the next cron tick. `/release` deletes the record ONLY
// when the caller is the recorded holder. A release from anyone else is a no-op that
// says so, because the loser of a claim knows the key by construction and a lease
// anybody can drop protects nothing.

/**
 * Minimal shapes for the Durable Object runtime, declared locally rather than
 * imported from `cloudflare:workers`. Only the members used here are described.
 *
 * worker-configuration.d.ts is committed now, so the real types are available and
 * this could import them. It stays local anyway: a narrow structural type is what
 * lets the tests drive `claim()` with a fake storage object, which is the whole
 * reason the claim logic is testable without a Workers runtime.
 */
type DurableStorage = {
  get: <T>(key: string) => Promise<T | undefined>
  put: <T>(key: string, value: T) => Promise<void>
  delete: (key: string) => Promise<boolean>
  deleteAll: () => Promise<void>
  setAlarm: (scheduledTime: number) => Promise<void>
}

type DurableState = {
  storage: DurableStorage
}

/** What a granted claim records, so a retry by the same holder is recognised. */
type ClaimRecord = {
  holder: string
  /** Epoch ms. After this the claim is expired and can be re-granted. */
  expiresAt: number
}

export type ClaimRequest = {
  /** Opaque owner of the claim: a request id for a jti, a run id for an outbox row. */
  holder: string
  /** How long the claim is held. A jti passes the token's remaining life; an
   *  outbox row passes a lease long enough to cover one provider call. */
  ttlMs: number
}

export type ClaimResponse = {
  granted: boolean
  /** Set when `granted` is false: who holds it and until when. */
  heldBy?: string
  expiresAt?: number
}

export type ReleaseRequest = {
  /** The same opaque owner the claim was granted to. Anything else is refused. */
  holder: string
}

export type ReleaseResponse = {
  released: boolean
  /** Set when `released` is false because somebody else holds the key. */
  heldBy?: string
}

const CLAIM_KEY = 'claim'

export class ClaimGuard {
  private readonly storage: DurableStorage

  constructor(state: DurableState) {
    this.storage = state.storage
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname !== '/claim' && url.pathname !== '/release') {
      return new Response('not found', { status: 404 })
    }
    if (request.method !== 'POST') {
      return new Response('method not allowed', { status: 405 })
    }

    if (url.pathname === '/release') {
      const release: ReleaseRequest = await request.json()
      return Response.json(await this.release(release))
    }

    const body: ClaimRequest = await request.json()
    const now = Date.parse(request.headers.get('x-claim-now') ?? '') || 0
    const result = await this.claim(body, now)
    return Response.json(result)
  }

  /**
   * The whole point of the class. Runs inside the DO's single-threaded handler,
   * so the get and the put cannot interleave with another request for this key.
   *
   * `now` is passed in rather than read from the clock so the logic is testable
   * and so a caller can use its own request timestamp consistently.
   */
  async claim({ holder, ttlMs }: ClaimRequest, now: number): Promise<ClaimResponse> {
    const at = now > 0 ? now : Date.now()
    const existing = await this.storage.get<ClaimRecord>(CLAIM_KEY)

    if (existing !== undefined && existing.expiresAt > at) {
      // Same holder retrying: idempotent yes. Different holder: no.
      if (existing.holder === holder) {
        return { granted: true }
      }
      return { granted: false, heldBy: existing.holder, expiresAt: existing.expiresAt }
    }

    const record: ClaimRecord = { holder, expiresAt: at + ttlMs }
    await this.storage.put(CLAIM_KEY, record)
    // Self-cleanup so consumed jti records do not accumulate for the life of the
    // namespace. Nothing depends on the alarm firing on time; an expired record
    // is already treated as absent by the check above.
    await this.storage.setAlarm(record.expiresAt + 60_000)
    return { granted: true }
  }

  /**
   * Hand the key back early, so the rest of the lease is not spent waiting.
   *
   * Deletes the record only when `holder` matches the one on it. That check is the
   * entire safety property: the caller that LOST a claim knows the key just as well as
   * the winner, so an unconditional delete would let it cancel the winner's lease
   * mid-work and hand the same submission to a third tick. A mismatch reports who holds
   * the key and changes nothing, which is also the right answer for a holder whose lease
   * lapsed and was re-granted while it was away.
   *
   * No `now`, unlike `claim`. Expiry is irrelevant here: an expired record still names
   * its owner, deleting it early is what expiry would have done anyway, and a record
   * that has already been re-granted fails the holder check instead. The cleanup alarm
   * the claim scheduled is left where it is: it only ever calls `deleteAll` on storage
   * this has already emptied, and cancelling it would need an API this narrow structural
   * type deliberately does not carry.
   */
  async release({ holder }: ReleaseRequest): Promise<ReleaseResponse> {
    const existing = await this.storage.get<ClaimRecord>(CLAIM_KEY)
    if (existing === undefined) return { released: false }
    if (existing.holder !== holder) return { released: false, heldBy: existing.holder }

    await this.storage.delete(CLAIM_KEY)
    return { released: true }
  }

  async alarm(): Promise<void> {
    await this.storage.deleteAll()
  }
}
