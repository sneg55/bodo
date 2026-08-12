// App input to an Airtable field set, for ImportRuns.
//
// Inherits to-fields.ts's whole reason for existing: a link is an ARRAY even when it
// holds one id, `null` clears a column, and an ABSENT key leaves the old value in place.
// Which of the last two a builder picks is a decision per column rather than a style, so
// each one below says which it made.
//
// The shape is EmailOutbox's, one step at a time: create queued, record a claim, write
// progress, write an outcome. The one addition is `importRunProgressFields`, because an
// import advances a PHASE at a time and the sender does not: a 500-session event does not
// fit in one Worker request (BUILD_SPEC 5.0e), so a CPU limit has to end a phase rather
// than the run, and that only works if each phase's progress is already durable.

import type { FieldSet } from '@/services/airtable/records'
import { COL } from '@/services/airtable/tables'
import { compact, link } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'
import type {
  ImportCounts,
  ImportMapping,
  ImportPhase,
  ImportRun,
  ImportSource,
  NeedsEmailRow,
} from '@/types/imports'

export type ImportRunDraft = {
  eventId: RecordId
  source: ImportSource
  /** The far side's identity. Never a credential: there is no column for one. */
  sourceRef: string
  /** The organizer's category choices. Empty for the two typed sources. */
  mapping: ImportMapping
}

/**
 * A fresh run, queued for the sweep to claim.
 *
 * `status` and `phase` are written explicitly rather than left to the column defaults,
 * for the reason `taskAssignmentFields` writes `pending` explicitly: `mapImportRun`
 * supplies a fallback for both, and a row that RELIED on that fallback would be
 * indistinguishable from a row whose cell somebody cleared by hand. Here the difference
 * is louder than usual, because the mapper's fallback for `status` is `failed`.
 *
 * `counts` is written as an empty object rather than left blank, so "nothing counted
 * yet" is a fact the row states. `needsEmailJson` is the opposite and is deliberately
 * ABSENT: `[]` would be the run claiming it looked for speakers with no address and
 * found none, and it has not looked at anything yet. That distinction is the whole
 * reason `mapImportRun` can treat its `[]` fallback as safe.
 */
export function importRunFields(draft: ImportRunDraft): FieldSet {
  return compact({
    [COL.event]: link(draft.eventId),
    [COL.source]: draft.source,
    [COL.sourceRef]: draft.sourceRef,
    [COL.mappingJson]: JSON.stringify(draft.mapping),
    [COL.status]: 'queued',
    [COL.phase]: 'metadata',
    [COL.counts]: JSON.stringify({}),
  })
}

export type ImportRunClaim = {
  /** Whoever won `claimOnce('import:<runId>')`. Recorded, never trusted as the grant. */
  leaseHolder: string
  leaseExpiresAt: string
  /**
   * Stamped on the FIRST claim only. A resumed run keeps the instant it began, because
   * that is what the history row means by "started"; re-stamping it on every phase would
   * make a long import look like it started seconds ago every time it was picked up.
   */
  startedAt?: string
}

/**
 * Record that a run is being worked on.
 *
 * NOTE: writing `leaseHolder` here does not ACQUIRE anything. Airtable has no
 * compare-and-swap, so two callers can both write it and both believe they won. Claiming
 * is `claimOnce()` in `@/utils/cf.ts`, backed by the ClaimGuard Durable Object; these
 * columns only record what that decided. Call this ONLY after
 * `claimOnce('import:<runId>', holder, ttl)` returned `granted: true`. It does not check,
 * because it cannot. BUILD_SPEC 5.0e, step 2.
 *
 * The lease columns carry a value rather than being omitted, so the row states who is
 * holding it and until when: a `running` row with no lease is the one shape the sweep in
 * reads-imports.ts cannot tell apart from a run abandoned mid-phase.
 */
export function importRunClaimFields(claim: ImportRunClaim): FieldSet {
  return compact({
    [COL.status]: 'running',
    [COL.leaseHolder]: claim.leaseHolder,
    [COL.leaseExpiresAt]: claim.leaseExpiresAt,
    [COL.startedAt]: claim.startedAt,
  })
}

export type ImportRunProgress = {
  /** The phase the run is about to work on, or the one it just finished. */
  phase: ImportPhase
  /** Cumulative for the run, not for the phase. See below. */
  counts: ImportCounts
}

/**
 * Where the run got to, written after every phase.
 *
 * `counts` is the whole run's totals and is REPLACED, not merged. Merging would have to
 * happen somewhere, and doing it here would mean reading the row back first: an extra
 * request per phase, racing with anything else that touched the row. The run engine
 * already holds the totals it has accumulated, so it sends them.
 *
 * Neither key is ever `null`. There is no such thing as clearing a phase or clearing the
 * counts: a run that has advanced has advanced, and a blank here would send a resumed run
 * back to `metadata` (see `mapImportRun`'s phase fallback) with its progress erased.
 */
export function importRunProgressFields(progress: ImportRunProgress): FieldSet {
  return {
    [COL.phase]: progress.phase,
    [COL.counts]: JSON.stringify(progress.counts),
  }
}

export type ImportRunOutcome = {
  /** Terminal only. A run that is still going writes progress, not an outcome. */
  status: Extract<ImportRun['status'], 'done' | 'failed'>
  finishedAt: string
  /** Absent on success, and cleared rather than left behind. */
  error?: string
  /**
   * The speakers created with no address. Absent and `[]` mean different things, which
   * is the point: see below.
   */
  needsEmail?: readonly NeedsEmailRow[]
}

/**
 * The end of a run.
 *
 * The lease columns are cleared with `null` rather than omitted, exactly as
 * `outboxOutcomeFields` clears them and for the same reason: a stale `leaseHolder` on a
 * finished row is what makes a later reader unsure whether a dead isolate is still
 * working on it, and the sweep's lapsed-lease rule would eventually hand a terminal row
 * to a job that has nothing to do with it.
 *
 * `error` carries `null` on success. A re-run gets a new history row rather than reusing
 * this one, so this only matters for a run that recovered from a failed phase, and there
 * the alternative is a row that reads `done` while still displaying the error it got
 * past. Truncated, because it goes in a cell an organizer reads, not a log.
 *
 * `needsEmailJson` is written whenever the caller passes a list, INCLUDING an empty one,
 * and omitted only when it passes nothing. That is the distinction `mapImportRun` leans
 * on: `[]` is the run saying it created speakers and all of them had an address, and a
 * blank cell is a run that failed before it ever got to the speakers phase. Collapsing
 * the two would make the mapper's `[]` fallback into the flattering lie it is careful
 * not to be.
 */
export function importRunOutcomeFields(outcome: ImportRunOutcome): FieldSet {
  return {
    [COL.status]: outcome.status,
    [COL.finishedAt]: outcome.finishedAt,
    [COL.leaseHolder]: null,
    [COL.leaseExpiresAt]: null,
    [COL.error]: outcome.error === undefined ? null : outcome.error.slice(0, 500),
    ...compact({
      [COL.needsEmailJson]:
        outcome.needsEmail === undefined ? undefined : JSON.stringify(outcome.needsEmail),
    }),
  }
}
