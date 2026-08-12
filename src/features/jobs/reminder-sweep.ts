// Composition of one reminder sweep: queue what has come due, then send what is queued.
//
// Split out of `reminders.ts` when the enqueue half became a list. That file is about
// WHICH reminders are due for one event; this one is about running the two halves in the
// right order and reporting what happened, and only this half knows there is more than one
// event in play.
//
// Two orderings are load-bearing and both are inherited from `reminders.ts`:
//
//   1. Enqueue BEFORE drain. A reminder that became due since the last sweep is sent in
//      the same run instead of waiting another five minutes, which matters most at the
//      24 hour offset, where five minutes of slack is the difference between "closes
//      tomorrow" and a deadline the speaker has already missed.
//   2. The enqueue half cannot fail the drain half. They read different tables and fail
//      for different reasons, so a rate-limited Forms read must not strand acceptance mail
//      that is already queued. A failure is reported in the result instead of thrown, and
//      the route turns a set `error` into a non-2xx status so it is still loud.
//
// Rule 2 now has a third edge, and it is the reason the enqueues run in SEQUENCE rather
// than through `Promise.all`: one event whose enqueue throws must not take the other
// events' enqueues down with it, and the DAL's per-base scheduler rate-limits anyway, so
// firing them together would buy nothing but a thundering herd against one Airtable base.

import { isAppError } from '@/constants/errorIds'
import { type DrainDeps, type DrainResult, drainOutbox } from '@/features/comms/drain'
import {
  type EnqueueCount,
  enqueueDraftReminders,
  type ReminderEnqueueDeps,
} from '@/features/jobs/reminders'

export type SweepDeps = {
  /**
   * One entry per event the sweep covers, because the enqueue half is event-scoped while
   * the drain half no longer is. A Cron Trigger names no event, so it passes every event
   * in the base; the admin "run now" button passes only the one it named.
   */
  reminders: readonly ReminderEnqueueDeps[]
  /** Everything `drainOutbox` needs except the holder, which this file mints. */
  drain: Omit<DrainDeps, 'holder'>
}

export type SweepResult = {
  /** Echoed so a `wrangler tail` line can be matched to the leases it took. */
  holder: string
  /** Summed across every event. `error` names the events that failed, so none is silent. */
  reminders: EnqueueCount & { error?: string }
  outbox: DrainResult
}

/**
 * A fresh identity for every sweep.
 *
 * `claimOnce` re-grants to the same holder on purpose, so a retry does not deadlock
 * against its own earlier lease. That makes a stable holder actively dangerous: two
 * overlapping sweeps sharing one would both be granted the same outbox row and both
 * send it.
 */
export function newSweepHolder(): string {
  return `sweep:${crypto.randomUUID()}`
}

async function enqueueOrReport(
  deps: ReminderEnqueueDeps,
): Promise<EnqueueCount & { error?: string }> {
  try {
    return await enqueueDraftReminders(deps)
  } catch (error) {
    return { queued: 0, skipped: 0, error: `${deps.eventId}: ${reason(error)}` }
  }
}

function reason(error: unknown): string {
  if (isAppError(error)) return `${error.id}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}

/**
 * Every event's enqueue, summed, with the failures named rather than counted.
 *
 * A single `error` string keeps `SweepResult` the shape the route and its tests already
 * expect. It carries the failing event ids because the alternative, a boolean, would say
 * only that SOME event's queue has stopped filling on a base with several of them, which
 * is the hardest kind of failure to chase in `wrangler tail`.
 */
async function enqueueAll(
  every: readonly ReminderEnqueueDeps[],
): Promise<EnqueueCount & { error?: string }> {
  const total = { queued: 0, skipped: 0 }
  const errors: string[] = []

  for (const deps of every) {
    const result = await enqueueOrReport(deps)
    total.queued += result.queued
    total.skipped += result.skipped
    if (result.error !== undefined) errors.push(result.error)
  }

  return errors.length === 0 ? total : { ...total, error: errors.join('; ') }
}

export async function runReminderSweep(deps: SweepDeps): Promise<SweepResult> {
  const holder = newSweepHolder()
  const reminders = await enqueueAll(deps.reminders)
  const outbox = await drainOutbox({ ...deps.drain, holder })

  return { holder, reminders, outbox }
}
