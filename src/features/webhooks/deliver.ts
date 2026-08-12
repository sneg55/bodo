// The POST, and the lease-and-claim loop around it.
//
// Modelled on src/features/comms/drain.ts, which it deliberately does not reuse: that drain
// is generic over everything except its one email-shaped seam, `send: (message: EmailMessage)
// => Promise<SendResult>`, and its `listDue` returns `OutboxRow`. Widening both would edit
// the path R3's mail runs on for a feature that shares nothing with mail but a retry policy.
// The shape is copied and the code is not, the call tables-webhooks.ts makes about the schema.
//
// Its protections carry over, with ONE missing, and that gap is worth stating rather than
// hiding. `claimOnce` (a Durable Object) still decides who owns a row, because Airtable has no
// compare-and-swap; the lease still expires, so a sender that died mid-POST releases the row;
// and the fence (`stillHolds`) still stops a sender that lost its lease during a slow POST
// from writing `failed` over the `sent` a fresher sender recorded. But there is NO
// provider-side idempotency key: a mail provider collapses a repeat, an arbitrary HTTP
// endpoint does not. What goes instead is `X-Bodo-Delivery`, which a receiver CAN use to drop
// a repeat and is under no obligation to, so a crash between a delivered POST and its outcome
// write can produce a second POST. That is at-least-once, which is what every webhook contract
// promises, and it is why that header exists at all.
//
// No module-level state. Isolates come and go, so a cache of "recently delivered" would be
// per-isolate: neither a lock nor a memo, just a lie.

import { MAX_ATTEMPTS } from '@/features/comms/drain'
import {
  type PreparedWebhookRequest,
  type WebhookEventType,
  webhookRequest,
} from '@/features/webhooks/dispatch'

/**
 * The mail drain's cap, re-exported rather than chosen again: both mean "a remote system is
 * not answering", and two caps would be two answers to how long bodo keeps knocking.
 */
export const WEBHOOK_MAX_ATTEMPTS = MAX_ATTEMPTS

/** How long a sender holds a delivery row. Longer than one POST, shorter than a sweep. */
export const WEBHOOK_LEASE_MS = 60_000

/**
 * How long one POST gets. An endpoint that accepts the connection and never answers would
 * otherwise hold the request until the runtime cancels it, losing the sweep and not the row.
 */
export const WEBHOOK_TIMEOUT_MS = 10_000

/** Enough of the receiver's complaint to debug it, not enough to fill an Airtable cell. */
const ERROR_TEXT_LIMIT = 300

export type WebhookPostResult = {
  /** The HTTP status, or 0 when there was no response at all (timeout, DNS, refused). */
  status: number
  ok: boolean
  /** The receiver's own words. This is what an organizer debugs their endpoint from. */
  error?: string
}

export type WebhookOutcome = 'sent' | 'retry' | 'dead'

/** A WebhookDeliveries row, joined to the subscription it belongs to. */
export type WebhookDeliveryRow = {
  id: string
  webhookId: string
  eventId: string
  webhookEvent: WebhookEventType
  url: string
  secret: string
  /** The EXACT bytes to POST, as snapshotted at enqueue. Never rebuilt. See dispatch.ts. */
  body: string
  attempts: number
  /** `idempotencyKey` on the row, sent as `X-Bodo-Delivery`. */
  deliveryKey: string
}

type LeaseRecord = { rowId: string; holder: string; leaseExpiresAt: string; attempts: number }

export type WebhookLease = {
  record: (input: LeaseRecord) => Promise<void>
  /** The holder recorded on the row right now, or undefined when it carries none. */
  heldBy: (rowId: string) => Promise<string | undefined>
}

/** `webhookId` rides along so the caller can stamp `lastStatus`/`lastAttemptAt` on the
 * subscription and expire its tag in the same write as the delivery's own outcome. */
type OutcomeInput = {
  rowId: string
  webhookId: string
  attempts: number
  status: string
  error: string
  dead: boolean
  at: string
}

export type WebhookDrainDeps = {
  /** Rows with status queued or failed and sendAt in the past. */
  listDue: () => Promise<readonly WebhookDeliveryRow[]>
  /** `claimOnce` from src/utils/cf.ts. The Durable Object is what makes this atomic. */
  claim: (key: string, holder: string, ttlMs: number) => Promise<{ granted: boolean }>
  post: (request: PreparedWebhookRequest, signal?: AbortSignal) => Promise<WebhookPostResult>
  /** The sweep's cancellation, threaded into every POST so an abandoned run stops knocking. */
  signal?: AbortSignal
  /** Absent runs the drain unfenced: nothing records a claim and no outcome is abandoned. */
  lease?: WebhookLease
  markSent: (input: Pick<OutcomeInput, 'rowId' | 'webhookId' | 'status' | 'at'>) => Promise<void>
  markFailed: (input: OutcomeInput) => Promise<void>
  /** Must be unique per invocation: `claimOnce` re-grants to the same holder. */
  holder: string
  nowMs: number
}

export type WebhookDrainResult = {
  claimed: number
  sent: number
  failed: number
  dead: number
  /** Rows another sender already held. Not an error, and not retried in this run. */
  skipped: number
  /** Outcomes thrown away because the row had moved on to a fresher holder. */
  fenced: number
}

/**
 * POST the prepared request, with a deadline and the caller's cancellation both honoured.
 *
 * Returns a result rather than throwing: a 500 from a receiver is the ordinary case here, and
 * a thrown transport error beside a returned status would put one decision in two places.
 */
export async function postWebhook(
  request: PreparedWebhookRequest,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<WebhookPostResult> {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? WEBHOOK_TIMEOUT_MS)
  // Both signals, so a cancelled sweep aborts the POST rather than waiting out the deadline.
  const signal =
    options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline])
  const send = options.fetchImpl ?? fetch

  try {
    const response = await send(request.url, {
      method: 'POST',
      headers: { ...request.headers },
      // The signed bytes, verbatim. Re-encoding an object here is dispatch.ts's rule 1.
      body: request.body,
      signal,
    })
    if (response.ok) return { status: response.status, ok: true }
    return { status: response.status, ok: false, error: await readError(response) }
  } catch (error) {
    // No response at all, which classifies as transient: a timeout and a refused connection
    // are both worth another attempt.
    return { status: 0, ok: false, error: describe(error) }
  }
}

/**
 * Whether the receiver's answer is worth another attempt.
 *
 * drain.ts's `refusedOutright` rule on a different transport, for its measured reason: a status
 * the receiver will return identically forever should not burn five sweeps. 404 and 401 are the
 * two that matter here, because that is what a DELETED Discord webhook and a rotated token
 * answer. 408, 429, every 5xx and status 0 stay transient, which is what the budget is for.
 */
export function classifyWebhookOutcome(input: {
  result: WebhookPostResult
  attempts: number
}): WebhookOutcome {
  if (input.result.ok) return 'sent'
  if (input.attempts >= WEBHOOK_MAX_ATTEMPTS) return 'dead'
  const httpStatus = input.result.status
  const refused = httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 429
  return refused ? 'dead' : 'retry'
}

/** Drain what is due. `holder` must be unique per invocation; see WebhookDrainDeps. */
export async function drainWebhookDeliveries(deps: WebhookDrainDeps): Promise<WebhookDrainResult> {
  const result = { claimed: 0, sent: 0, failed: 0, dead: 0, skipped: 0, fenced: 0 }

  for (const row of await deps.listDue()) {
    const claim = await deps.claim(`webhook-delivery:${row.id}`, deps.holder, WEBHOOK_LEASE_MS)
    if (!claim.granted) {
      // Another sender owns it. Leaving it alone is the entire point.
      result.skipped += 1
      continue
    }
    result.claimed += 1

    // Reap a row that already burned the cap before spending another POST on it. Only a
    // recorded outcome writes `dead`, so a row whose sender dies every time never reached that
    // branch: it would cycle forever with `attempts` climbing. Same reaping as drain.ts.
    if (row.attempts >= WEBHOOK_MAX_ATTEMPTS) {
      await fail(deps, result, {
        rowId: row.id,
        webhookId: row.webhookId,
        attempts: row.attempts,
        status: '',
        error: `abandoned after ${String(row.attempts)} attempts without a recorded outcome`,
        dead: true,
        at: new Date(deps.nowMs).toISOString(),
      })
      continue
    }

    await deliverOne(row, deps, result)
  }

  return result
}

async function deliverOne(
  row: WebhookDeliveryRow,
  deps: WebhookDrainDeps,
  result: WebhookDrainResult,
): Promise<void> {
  // The attempt is recorded with the CLAIM rather than with the outcome, so a sender that dies
  // mid-POST has still spent one and the row walks toward `dead` instead of cycling forever.
  const attempts = row.attempts + 1
  const at = new Date(deps.nowMs).toISOString()
  const base = { rowId: row.id, webhookId: row.webhookId, attempts, at }

  try {
    await deps.lease?.record({
      rowId: row.id,
      holder: deps.holder,
      leaseExpiresAt: new Date(deps.nowMs + WEBHOOK_LEASE_MS).toISOString(),
      attempts,
    })

    const request = await webhookRequest({
      url: row.url,
      secret: row.secret,
      body: row.body,
      eventType: row.webhookEvent,
      deliveryId: row.deliveryKey,
    })
    const posted = await deps.post(request, deps.signal)
    if (!(await stillHolds(deps, row.id))) {
      result.fenced += 1
      return
    }

    const outcome = classifyWebhookOutcome({ result: posted, attempts })
    const status = posted.status === 0 ? '' : String(posted.status)
    if (outcome === 'sent') {
      await deps.markSent({ rowId: row.id, webhookId: row.webhookId, status, at })
      result.sent += 1
      return
    }
    const error = posted.error ?? `HTTP ${String(posted.status)}`
    await fail(deps, result, { ...base, status, error, dead: outcome === 'dead' })
  } catch (error) {
    // Signing or the lease write failed, so no POST was made. The fence still applies: the
    // write it abandons is a stale sender turning somebody else's `sent` into a failure.
    if (!(await stillHolds(deps, row.id))) {
      result.fenced += 1
      return
    }
    const dead = attempts >= WEBHOOK_MAX_ATTEMPTS
    await fail(deps, result, { ...base, status: '', error: describe(error), dead })
  }
}

/** One place decides which counter a failed outcome increments, so the two cannot drift. */
async function fail(
  deps: WebhookDrainDeps,
  result: WebhookDrainResult,
  input: OutcomeInput,
): Promise<void> {
  await deps.markFailed(input)
  result[input.dead ? 'dead' : 'failed'] += 1
}

/**
 * Whether the row still records this run as its holder. Read-then-compare, so BEST EFFORT: it
 * rules out the wide case (a lease lost minutes ago) and not the narrow one (a handover inside
 * the gap between this read and the write that follows). An unreadable row means abandon rather
 * than guess, because an outcome that cannot be fenced is the one that might regress a fresher
 * result.
 */
async function stillHolds(deps: WebhookDrainDeps, rowId: string): Promise<boolean> {
  const lease = deps.lease
  if (lease === undefined) return true
  try {
    return (await lease.heldBy(rowId)) === deps.holder
  } catch {
    return false
  }
}

async function readError(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, ERROR_TEXT_LIMIT)
  } catch {
    // The status already decided the outcome, and this string is only ever shown to a human.
    return ''
  }
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
