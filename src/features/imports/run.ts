// The import run engine. Claim a run, advance it a phase at a time, record the outcome.
//
// This is the shape the codebase already has for work that must not half-happen, and it
// is the outbox drain's shape for the outbox's reason: Airtable has no transaction and no
// compare-and-swap, so "read the queued rows, mark them running, import them" is not safe.
// Two overlapping cron invocations read the same row, mark it, and both import the event.
//
// Three protections, and each covers what the others cannot:
//
//   1. `claimOnce` (the ClaimGuard Durable Object, keyed `import:<runId>`) decides who
//      owns the run. Only the winner writes anything. This is the compare-and-swap
//      Airtable lacks, and nothing here invents a second locking scheme.
//   2. The lease EXPIRES. A run whose isolate died mid-phase is resumable at all only
//      because of this: `dueImportRuns` hands back a `running` row once its lease lapses.
//      A Worker CPU limit therefore ends a PHASE, not the run.
//   3. `IntegrationMappings` makes the redo safe: protection 2 means a phase can be
//      re-entered, and the ledger turns what the dead attempt created into an update.
//
// The row's own `status`, `leaseHolder` and `leaseExpiresAt` columns are a fourth thing
// and NOT a fourth protection: they are visibility, plus FENCING. A run can lose its lease
// mid-phase, a second worker can pick it up and finish it, and the first worker's later
// write would then regress a finished row. So before every write of progress or outcome
// the holder on the row is compared against this run's own. That is a read then a compare,
// so it is BEST EFFORT: the window narrows, it does not close.
//
// Every dependency arrives through `ImportRunDeps`, which is what lets a test drive the
// whole engine, both sweeps of a contended claim included, without a network at all.

import { ErrorIds, isAppError } from '@/constants/errorIds'
import type { SourceFetch, SourceRequest } from '@/features/imports/fetch-source'
import { createLedger } from '@/features/imports/ledger'
import type { RoundTripGuard } from '@/features/imports/normalize'
import {
  needsEmailFrom,
  nextPhase,
  type PhaseContext,
  type PhaseOutcome,
  remainingPhases,
  runMetadataPhase,
  runSpeakersPhase,
} from '@/features/imports/phases'
import { runAgendaPhase, runSubmissionsPhase } from '@/features/imports/phases-content'
import { authoredRemoteIds, mergeCounts } from '@/features/imports/ports'
import { type RunProgress, reported, settleNeedsEmail } from '@/features/imports/run-progress'
import {
  IMPORT_LEASE_MS,
  type ImportRunDeps,
  type ImportRunReport,
} from '@/features/imports/run-types'
import type { ImportRunWrite } from '@/services/airtable/mutations-imports'
import type { RecordId } from '@/types/domain'
import type { ImportCounts, ImportPhase, ImportRun, NeedsEmailRow } from '@/types/imports'

// Re-exported so `@/features/imports/run` stays the one import path the engine's callers
// use: the wizard hook, the sweep, the Server Action and the wiring all name it.
export {
  IMPORT_LEASE_MS,
  type ImportRunDeps,
  type ImportRunReport,
  type RunAttempt,
} from '@/features/imports/run-types'

/** A chain rather than a lookup table, so a runtime phase name never indexes an object. */
function runnerFor(phase: ImportPhase): (ctx: PhaseContext) => Promise<PhaseOutcome> {
  if (phase === 'metadata') return runMetadataPhase
  if (phase === 'speakers') return runSpeakersPhase
  if (phase === 'submissions') return runSubmissionsPhase
  return runAgendaPhase
}

/**
 * Advance one run as far as this invocation is allowed to take it.
 *
 * The far side is re-read every invocation, and that is not waste: it is exactly the read
 * the preview already made, it is the only way a resumed run sees a source that changed
 * under it, and holding a 500-session payload across invocations would need somewhere to
 * put it that a Worker isolate does not have.
 *
 * That fresh read is a LATEST snapshot, not a record of what this run did, and one thing
 * must never be built out of it: the Needs-email list, which is a claim about bodo's own
 * speaker rows. `readSpeakers` is where that comes from now. See `needsEmailFrom`.
 */
export async function runImport(runId: RecordId, deps: ImportRunDeps): Promise<ImportRunReport> {
  const run = await deps.getRun(runId)
  const empty = { runId, phases: [], counts: run.counts, needsEmail: run.needsEmail }

  // A terminal row is not work. A failed run is re-run by the organizer pressing Import,
  // which creates a fresh history row rather than reopening this one.
  if (run.status === 'done' || run.status === 'failed') return { ...empty, attempt: 'terminal' }

  const granted = await deps.claim(`import:${runId}`, deps.holder, IMPORT_LEASE_MS)
  if (!granted.granted) return { ...empty, attempt: 'contended' }

  const startedAt = run.startedAt ?? deps.now()
  const write: ImportRunWrite = { runId, eventId: run.eventId }
  await deps.claimRun(write, {
    leaseHolder: deps.holder,
    leaseExpiresAt: new Date(Date.parse(deps.now()) + IMPORT_LEASE_MS).toISOString(),
    // Stamped on the FIRST claim only, so a long import does not look like it started
    // seconds ago every time a sweep picks it up.
    startedAt: run.startedAt === undefined ? startedAt : undefined,
  })

  // Carried in a box rather than returned, so a failure in a LATER phase still reports what
  // the earlier ones accumulated: losing the Needs-email list to a failed agenda phase
  // would leave the organizer owed a list nothing ever produces again.
  const held: RunProgress = { counts: run.counts, needsEmail: run.needsEmail }
  try {
    return await advance(run, write, deps, held)
  } catch (error) {
    return await recordFailure(held, write, deps, error)
  }
}

async function advance(
  run: ImportRun,
  write: ImportRunWrite,
  deps: ImportRunDeps,
  held: RunProgress,
): Promise<ImportRunReport> {
  const index = await deps.loadRemoteIndex(run.eventId)
  const fetched = await deps.fetch(
    { source: run.source, sourceRef: run.sourceRef, mapping: run.mapping },
    // The round-trip guard, and the engine is what supplies it. `normalizeAccelevents`
    // skips these and counts the skips; nothing subtracts them silently.
    { authoredRemoteIds: authoredRemoteIds(index, run.source) },
  )

  const ctx: PhaseContext = {
    eventId: run.eventId,
    source: run.source,
    normalized: fetched.normalized,
    ledger: createLedger({
      index,
      source: run.source,
      eventId: run.eventId,
      now: deps.now(),
      save: deps.write.saveMappings,
    }),
    write: deps.write,
    readSpeakers: async () => await deps.readSpeakers(run.eventId),
  }

  const todo = remainingPhases(run.phase)
  const budget = deps.maxPhases ?? todo.length
  const done: ImportPhase[] = []

  // Armed here when an EARLIER invocation already did the speakers phase, which is the
  // case the row alone cannot express: `remainingPhases` no longer lists it, so this
  // invocation would otherwise finish or fail knowing nothing about any addressless
  // speaker the run created.
  if (!todo.includes('speakers')) held.derive = async () => await needsEmailFrom(ctx)

  for (const phase of todo.slice(0, Math.max(budget, 0))) {
    // Checked BEFORE the phase as well as after it, and the read above is why it is worth
    // a request: `loadRemoteIndex` and `fetch` are the slow half of an invocation, so a
    // lease can lapse and a second worker can claim and finish the run while this one is
    // still waiting on the far side. Without this the loser only discovered that after
    // writing a whole phase over the winner's work.
    if (!(await stillHolds(deps, write.runId))) {
      return { runId: write.runId, attempt: 'fenced', phases: done, ...reported(held) }
    }

    const outcome = await runnerFor(phase)(ctx)
    held.counts = mergeCounts(held.counts, outcome.counts)
    // Armed the moment the speakers phase is behind us, so a submissions or agenda phase
    // that throws in THIS invocation still settles the list on its way out. Armed rather
    // than evaluated, because it costs a full read of the Speakers table and the outcome is
    // the only place that needs the answer.
    if (phase === 'speakers') held.derive = async () => await needsEmailFrom(ctx)

    // Progress is written AFTER the phase's records are in Airtable, never before.
    // Advancing first would have a resumed run skip a phase whose writes never landed.
    //
    // The window that leaves is real and is left open deliberately: an isolate killed
    // between the last record of a phase and this line comes back, redoes the phase, and
    // finds its own mappings, so it reports as `updated` what it actually created. The
    // RECORDS are right (that is what the ledger is for) and only the counts are, and
    // closing it needs a compare-and-swap Airtable does not have. A second lock is not the
    // answer either: `claimOnce` is the lock, and these columns record what it decided.
    if (!(await stillHolds(deps, write.runId))) {
      return { runId: write.runId, attempt: 'fenced', phases: done, ...reported(held) }
    }
    await deps.advanceRun(write, { phase: nextPhase(phase), counts: held.counts })
    done.push(phase)
  }

  const finished = done.length === todo.length
  // Read off bodo's own speaker rows rather than carried on the row, because the checkpoint
  // above cannot carry it: `ImportRunProgress` is phase and counts, so a run that spans
  // invocations (every real one, at `maxPhases: 1`) reloaded `[]` here and finished telling
  // the organizer that nobody needs an address. See `needsEmailFrom` and `settleNeedsEmail`.
  await settleNeedsEmail(held)
  const report = { runId: write.runId, phases: done, ...reported(held) }
  if (!finished) return { ...report, attempt: 'advanced' }

  await deps.finishRun(write, {
    status: 'done',
    finishedAt: deps.now(),
    // Passed even when empty, because `[]` and a blank cell mean different things: `[]`
    // is "speakers were imported and all of them had an address", and blank is a run that
    // never reached the speakers phase.
    needsEmail: held.needsEmail,
  })
  return { ...report, attempt: 'done' }
}

/**
 * A failure the engine caught, which is not the same as a run that was killed.
 *
 * A killed isolate writes nothing and comes back through the lapsed-lease branch of
 * `dueImportRuns`, which is what makes a CPU limit end a phase rather than the run. What
 * reaches here is an error the source or the base returned, and that is terminal: there
 * is no attempts column on `ImportRuns`, so an automatic retry would have nothing to stop
 * it and a permanently failing source would be re-imported forever.
 *
 * One exception, and it is a credential rather than a failure. A Sessionboard run cannot
 * be resumed by a sweep that holds no token, because there is deliberately no credential
 * column. That is left `running` with a lapsed lease so the organizer's own request can
 * pick it up, rather than being burned to `failed`.
 */
async function recordFailure(
  held: RunProgress,
  write: ImportRunWrite,
  deps: ImportRunDeps,
  error: unknown,
): Promise<ImportRunReport> {
  // BEFORE the report is built, and swallowing its own failure on purpose. This is what
  // was missing: a run whose speakers phase had already found addressless speakers, and
  // whose LATER phase then threw, was written failed carrying no list, because
  // `held.needsEmail` was seeded off a row that never persists one. The swallow is because
  // the error already in hand is the one worth reporting; losing it to a second failure in
  // the speaker read would leave the organizer with neither.
  await settleNeedsEmail(held).catch(() => undefined)

  const report = {
    runId: write.runId,
    phases: [],
    ...reported(held),
    error: describe(error),
  }
  if (isAppError(error) && error.id === ErrorIds.CFG_ENV_MISSING) {
    return { ...report, attempt: 'no-client' }
  }
  if (!(await stillHolds(deps, write.runId))) return { ...report, attempt: 'fenced' }

  await deps.finishRun(write, {
    status: 'failed',
    finishedAt: deps.now(),
    error: report.error,
    // Absent, not `[]`, ONLY when this run never reached the speakers phase: it has not
    // looked for addresses, and `[]` would claim it looked and found none. Once the phase
    // has run the list is written whatever its length, empty included, because then `[]`
    // is the true answer rather than an absence dressed up as one.
    needsEmail:
      held.derive === undefined && held.needsEmail.length === 0 ? undefined : held.needsEmail,
  })
  return { ...report, attempt: 'failed' }
}

/**
 * Whether the row still records this invocation as its holder.
 *
 * Read then compare, and best effort for that reason: the row can change between this
 * read and the write that follows. What it rules out is the wide case, a worker whose
 * lease lapsed during a long phase while another worker finished the run. An unreadable
 * row means abandon rather than guess, because an outcome that cannot be fenced is
 * exactly the outcome that might regress a fresher one.
 */
async function stillHolds(deps: ImportRunDeps, runId: RecordId): Promise<boolean> {
  const read = deps.heldBy
  if (read === undefined) return true
  try {
    return (await read(runId)) === deps.holder
  } catch {
    return false
  }
}

function describe(error: unknown): string {
  if (isAppError(error)) return error.toLogLine()
  if (error instanceof Error) return error.message
  return String(error)
}
