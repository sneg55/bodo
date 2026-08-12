// The sweep: work every import run that is due. What the cron route calls.
//
// A file of its own rather than the bottom of run.ts, and the 300-line ceiling is only
// half the reason. The other half is that this is the only piece the Cron Trigger reaches,
// so the boundary is worth being able to see: run.ts decides what happens to ONE run, and
// this decides which runs get looked at and in what order.
//
// It holds no policy about claiming. `runImport` claims each run through the ClaimGuard
// Durable Object, so two overlapping invocations of this sweep process a run exactly once,
// and the second one counts it as contended rather than doing the work again.

import { type ImportRunDeps, runImport } from '@/features/imports/run'
import type { ImportRun } from '@/types/imports'

export type ImportSweepDeps = ImportRunDeps & {
  /**
   * Queued runs plus `running` ones whose lease has lapsed. Never cached: a cached queue
   * hands a second invocation the runs the first has already picked up.
   */
  listDue: (nowIso: string) => Promise<readonly ImportRun[]>
}

export type ImportSweepResult = {
  found: number
  /** Runs that got further but are not finished. Another invocation will carry them on. */
  advanced: number
  done: number
  failed: number
  /** Runs another sweep already held. Not an error, and not retried in this invocation. */
  contended: number
  /** Runs left exactly as they were found: no client for the source, fenced, or terminal. */
  skipped: number
}

/**
 * One sweep, oldest run first.
 *
 * Sequential rather than concurrent, and that is the §3.1 rate cap rather than caution: an
 * import is the heaviest write path in this codebase, and two runs interleaved against one
 * base would spend the request budget the phases need on each other.
 *
 * The clock is read ONCE and handed to the filter, so a single instant decides which leases
 * have lapsed. A clock read per row would move that boundary underneath the filter.
 */
export async function sweepImportRuns(deps: ImportSweepDeps): Promise<ImportSweepResult> {
  const due = await deps.listDue(deps.now())
  const result: ImportSweepResult = {
    found: due.length,
    advanced: 0,
    done: 0,
    failed: 0,
    contended: 0,
    skipped: 0,
  }

  for (const run of due) {
    const report = await runImport(run.id, deps)
    if (report.attempt === 'done') result.done += 1
    if (report.attempt === 'advanced') result.advanced += 1
    if (report.attempt === 'failed') result.failed += 1
    if (report.attempt === 'contended') result.contended += 1
    // Fenced, terminal and no-client are all "this run belongs to somebody else, or to a
    // caller holding a credential this one does not". None of them is progress and none is
    // a failure, so reporting them as either would make the sweep's numbers lie.
    if (
      report.attempt === 'fenced' ||
      report.attempt === 'terminal' ||
      report.attempt === 'no-client'
    ) {
      result.skipped += 1
    }
  }

  return result
}
