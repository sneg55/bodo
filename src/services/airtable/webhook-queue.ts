// The webhook queue's SELECTION policy: which due rows a sweep attempts, and which of them
// have outlived the subscription they belong to.
//
// Split out of reads-webhooks.ts, which was at the 300-line ceiling, and the seam is the one
// that file's own comments kept pointing at: both functions here are PURE and were already
// documented as "separate from the read, because it is where a queue-stalling bug lived and it
// has to be testable without a network". Nothing in this file touches the client, the cache,
// or a tag; `listDueWebhookDeliveries` next door is what does the I/O and calls these two in
// order. Keeping the policy here also keeps the file that holds it short enough to read in one
// screen, which matters for code whose failures are all "the queue quietly stopped".

import type { WebhookDeliveryRecord } from '@/types/webhook'

/**
 * Rows the sender should attempt now, decided in memory. Pure, so the policy is testable.
 *
 * The status set is `dueOutboxRows`' and is the same policy for the same reasons, which are
 * written out there in full: `failed` is included or the retry budget is unreachable,
 * `sending` is included or a sender that died mid-POST strands its row forever, and the lease
 * check is a PRE-FILTER rather than the lock. `claimOnce` and its Durable Object are what
 * actually stop two sweeps sending one row; this only avoids handing the drain rows it would
 * certainly fail to claim.
 *
 * `sendAt <= nowIso` is a string comparison, correct only because every instant this DAL
 * writes is an ISO-8601 UTC string of the same shape, so lexical order is chronological.
 * Oldest first, so a backlog drains in the order it was queued.
 */
export function dueWebhookDeliveries(
  rows: readonly WebhookDeliveryRecord[],
  nowIso: string,
  limit: number,
): readonly WebhookDeliveryRecord[] {
  return rows
    .filter(
      (row) =>
        (row.status === 'queued' || row.status === 'failed' || row.status === 'sending') &&
        row.sendAt <= nowIso &&
        (row.leaseExpiresAt === undefined || row.leaseExpiresAt <= nowIso),
    )
    .sort((left, right) => left.sendAt.localeCompare(right.sendAt))
    .slice(0, limit)
}

/**
 * Split due rows into the ones that can be sent and the ones whose subscription is gone.
 *
 * The rule that matters is which side the LIMIT applies to: it is a budget of rows to SEND, so
 * only a deliverable row spends it. Slicing the due list before this join is what starved the
 * queue, because once the oldest `limit` due rows were all orphans, every sweep selected
 * exactly those, discarded all of them, and never looked at the deliverable row sitting behind
 * them.
 *
 * Orphans are capped at `limit` as well, but for the opposite reason: they cost a write each,
 * so a backlog of them is retired over a few sweeps rather than in one long isolate. They stop
 * being selected as soon as that write lands, so the cap delays the cleanup and can never
 * reinstate the stall.
 *
 * Generic in the endpoint so the caller's Map type flows through, and so a test can partition
 * against a plain object without constructing `WebhookRow`s.
 */
export function partitionDueWebhookDeliveries<Endpoint>(
  due: readonly WebhookDeliveryRecord[],
  // Takes the id as the ROW holds it, `undefined` included: a deleted subscription leaves the
  // link cell EMPTY rather than dangling, so that is the ordinary shape of an orphan and the
  // reason `mapWebhookDelivery` reads the link as optional.
  endpointOf: (webhookId: string | undefined) => Endpoint | undefined,
  limit: number,
): {
  readonly deliverable: readonly { row: WebhookDeliveryRecord; endpoint: Endpoint }[]
  readonly orphaned: readonly WebhookDeliveryRecord[]
} {
  const deliverable: { row: WebhookDeliveryRecord; endpoint: Endpoint }[] = []
  const orphaned: WebhookDeliveryRecord[] = []

  for (const row of due) {
    if (deliverable.length >= limit && orphaned.length >= limit) break
    const endpoint = endpointOf(row.webhookId)
    if (endpoint === undefined) {
      if (orphaned.length < limit) orphaned.push(row)
    } else if (deliverable.length < limit) {
      deliverable.push({ row, endpoint })
    }
  }

  return { deliverable, orphaned }
}
