// POST /api/cron/webhooks: deliver what the webhook queue is holding.
//
// The auth shape is `/api/cron/reminders`' shape, deliberately identical: the Cron Trigger in
// src/entrypoints/worker.ts calls the Next handler in-process with CRON_SECRET in a header,
// and an admin "run now" button would POST the same secret to the same URL, so there is one
// auth path and no special case for the scheduler. The two rules that route states apply here
// unchanged:
//
//   1. `assertCronAuthorized` runs FIRST. This endpoint POSTs to arbitrary third-party URLs,
//      so an unauthorized caller who reached it could make bodo hammer them on demand.
//   2. Nothing throws out of here. `scheduled()` logs the status and the body when a response
//      is not ok, so a failure that escapes as an exception is a sweep that failed with
//      nothing in `wrangler tail` to say why.
//
// **The deps are assembled here rather than in a `*-wiring.ts` file**, which is a deviation
// from `/api/cron/reminders` worth naming. That route hands off to `runRemindersJob` because
// the sweep it runs has real logic (which events, which drafts, which templates) that has to
// be testable from neither entry point. There is no such logic here: `drainWebhookDeliveries`
// already IS the feature function, it already takes every seam as an argument, and it is
// already tested that way. What is left is nine bindings of a DAL call to a named dep, which
// is what a route handler is for.

import { ErrorIds, isAppError } from '@/constants/errorIds'
import { assertCronAuthorized } from '@/features/jobs/cron-auth'
import {
  drainWebhookDeliveries,
  postWebhook,
  type WebhookDrainDeps,
} from '@/features/webhooks/deliver'
import {
  claimWebhookDelivery,
  markWebhookDeliveryFailed,
  markWebhookDeliverySent,
} from '@/services/airtable/mutations-webhooks'
import {
  listDueWebhookDeliveries,
  webhookDeliveryLeaseHolder,
} from '@/services/airtable/reads-webhooks'
import { claimOnce } from '@/utils/cf'

/**
 * Rows per sweep.
 *
 * A whole-base ceiling rather than a per-event one, same reasoning as the outbox drain: each
 * row costs an outbound POST plus two Airtable writes, Airtable allows five requests a second
 * per base, and oldest-first across the base is what keeps the bound fair between events. A
 * backlog drains over several sweeps rather than in one long isolate.
 */
const DRAIN_LIMIT = 25

export async function POST(request: Request): Promise<Response> {
  try {
    assertCronAuthorized(request)

    const result = await drainWebhookDeliveries({
      ...webhookDrainDeps(Date.now(), request.signal),
      // Per invocation, and it MUST be: `claimOnce` re-grants to the same holder so a retry
      // does not deadlock against its own earlier lease, which means a holder derived from
      // anything stable would hand every concurrent sweep the same rows.
      holder: crypto.randomUUID(),
    })

    return Response.json({
      ok: true,
      // Echoed back so a log line names the schedule that produced it. Absent for a manual
      // call, which is the other caller.
      schedule: request.headers.get('x-cron-schedule') ?? 'manual',
      ...result,
    })
  } catch (error) {
    if (isAppError(error)) {
      console.error(error.toLogLine())
      return Response.json(
        { ok: false, error: error.message, id: error.id },
        { status: statusFor(error.id) },
      )
    }
    // Still a response, and still carries something to grep for. An unknown throw here would
    // otherwise reach the runtime as an unhandled rejection inside `scheduled()`.
    console.error('[cron] webhook sweep failed with a non-AppError', error)
    return Response.json({ ok: false, error: 'the webhook sweep failed' }, { status: 500 })
  }
}

/**
 * Everything `drainWebhookDeliveries` needs except the holder.
 *
 * Two per-invocation Maps, and neither is module state: isolates come and go, so anything
 * cached across requests would be a lie. `attempts` exists because the drain hands `markSent`
 * a row id and nothing else while the DAL records the attempt count with the outcome, and
 * `events` because one sweep covers the whole base, so an outcome write tagged with the wrong
 * event would expire the wrong settings screen and leave the right one stale.
 */
function webhookDrainDeps(nowMs: number, signal: AbortSignal): Omit<WebhookDrainDeps, 'holder'> {
  const attempts = new Map<string, number>()
  const events = new Map<string, string>()
  const eventOf = (rowId: string): string => events.get(rowId) ?? ''

  return {
    listDue: async () => {
      const rows = await listDueWebhookDeliveries(new Date(nowMs).toISOString(), DRAIN_LIMIT)
      for (const row of rows) {
        attempts.set(row.id, row.attempts)
        events.set(row.id, row.eventId)
      }
      return rows
    },
    claim: claimOnce,
    // The request's cancellation, threaded into every POST, so a sweep the runtime gives up on
    // stops knocking on receivers instead of holding connections open until it is killed.
    signal,
    post: (prepared, postSignal) => postWebhook(prepared, { signal: postSignal }),
    // Records the claim on the row and reads back who holds it. Without BOTH halves the fence
    // in `drainWebhookDeliveries` is inert: `stillHolds` returns true when `lease` is absent,
    // which keeps the unfenced path working and would also have quietly kept the whole
    // protection switched off in production.
    lease: {
      record: ({ rowId, holder, leaseExpiresAt, attempts: attemptCount }) =>
        claimWebhookDelivery(
          { rowId, leaseHolder: holder, leaseExpiresAt, attempts: attemptCount },
          'route',
        ),
      heldBy: webhookDeliveryLeaseHolder,
    },
    markSent: ({ rowId, webhookId, status, at }) =>
      markWebhookDeliverySent(
        {
          rowId,
          webhookId,
          eventId: eventOf(rowId),
          attempts: (attempts.get(rowId) ?? 0) + 1,
          status,
          at,
        },
        'route',
      ),
    markFailed: ({ rowId, webhookId, attempts: attemptCount, status, error, dead, at }) =>
      markWebhookDeliveryFailed(
        {
          rowId,
          webhookId,
          eventId: eventOf(rowId),
          attempts: attemptCount,
          status,
          error,
          dead,
          at,
        },
        'route',
      ),
    nowMs,
  }
}

function statusFor(id: string): number {
  // A refused secret is 401 and not 403: the caller presented no usable credential, and both
  // cron callers authenticate with the same header.
  if (id === ErrorIds.AUTH_FORBIDDEN_ROLE) return 401
  // Unconfigured rather than broken: no Airtable base, no claim guard binding. Retrying
  // without a deploy change will not help, and 503 says so.
  if (
    id === ErrorIds.CFG_ENV_MISSING ||
    id === ErrorIds.CFG_BINDING_MISSING ||
    id === ErrorIds.CFG_BINDING_FAILED
  ) {
    return 503
  }
  return 500
}
