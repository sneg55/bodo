// What the two Accelevents controls report back, as one sentence each.
//
// Pure, and in its own module rather than inside actions.ts, for a mechanical reason: a
// `'use server'` file may only export async functions, so a helper that turns a result
// into a sentence cannot live there. Being pure is also what lets the counting be unit
// tested (tests/integrations-actions.test.ts) instead of verified by pressing a button
// against a real base.
//
// Both sentences lead with what LANDED and name failures last but never omit them. A
// toast that says "Sync complete" over three failed sessions is the exact behaviour
// BUILD_SPEC 5.0d objects to in the vendor's own product, where a sync failure is routed
// to support with a screenshot rather than surfaced in the product.

import type { AcceleventsSyncResult } from '@/features/jobs/accelevents-sync'
import type { EntityCounts, ForwardSyncResult } from '@/services/accelevents/sync'

export type SyncSummary = {
  readonly message: string
  /** True when something needs an organizer's attention, so the toast is not a success. */
  readonly needsAttention: boolean
}

/** Every entity type's counts, added up. The toast is a total, the log is the detail. */
export function totalCounts(result: ForwardSyncResult): EntityCounts {
  const total: EntityCounts = { created: 0, updated: 0, skipped: 0, failed: 0, contended: 0 }
  for (const one of Object.values(result.counts)) {
    total.created += one.created
    total.updated += one.updated
    total.skipped += one.skipped
    total.failed += one.failed
    total.contended += one.contended
  }
  return total
}

/**
 * `Sync now` over the whole event.
 *
 * `blocked` is reported separately from `failed` and the difference matters to whoever
 * reads it. A failure reached Accelevents and was refused, so it is in the sync log and
 * the retry sweep will pick it up. A BLOCKED entity was never sent and could not even be
 * logged (`sync-walk.ts` explains why: an unparseable payload would abort every later
 * retry), so nothing will ever retry it and the fix is upstream in bodo's own data. Both
 * counts as one number would tell an organizer to press `Retry failed` on rows no retry
 * can see.
 */
export function summarizeSync(result: ForwardSyncResult): SyncSummary {
  const counts = totalCounts(result)
  const parts = [
    `${counts.created} created`,
    `${counts.updated} updated`,
    `${counts.skipped} unchanged`,
  ]
  if (counts.failed > 0) parts.push(`${counts.failed} failed`)
  if (counts.contended > 0) parts.push(`${counts.contended} already in flight`)
  if (result.blocked > 0) parts.push(`${result.blocked} could not be sent`)

  return {
    message: `Sync now: ${parts.join(', ')}.`,
    needsAttention: counts.failed > 0 || result.blocked > 0,
  }
}

/**
 * `Retry failed`.
 *
 * `found` is included even when it is zero, and that empty case is the one worth getting
 * right: "nothing to retry" and "retried nothing" read the same in a count and mean
 * opposite things. An organizer who has just watched a sync fail needs to know which one
 * they got.
 */
export function summarizeRetry(result: AcceleventsSyncResult): SyncSummary {
  if (result.found === 0) {
    return { message: 'Retry failed: nothing is waiting to be retried.', needsAttention: false }
  }

  const parts = [`${result.succeeded} succeeded`, `${result.skipped} already up to date`]
  if (result.failed > 0) parts.push(`${result.failed} failed again`)
  if (result.contended > 0) parts.push(`${result.contended} held by another run`)

  return {
    message: `Retry failed: ${result.found} row${result.found === 1 ? '' : 's'} found, ${parts.join(', ')}.`,
    needsAttention: result.failed > 0,
  }
}
