// What one import run needs, and what one invocation of it reports.
//
// Types only, split out of run.ts for the 300-line ceiling. They are here rather than in
// ports.ts because ports.ts is what the PHASES and the preview share, and none of this is
// theirs: `ImportRunDeps` is the engine's boundary, and `ImportRunReport` is what a sweep
// or a wizard step reads back. run.ts re-exports all four, so every existing caller keeps
// importing from `@/features/imports/run`.

import type { SourceFetch, SourceRequest } from '@/features/imports/fetch-source'
import type { RoundTripGuard } from '@/features/imports/normalize'
import type { ImportWritePorts, LocalSpeaker } from '@/features/imports/ports'
import type { ImportRunWrite } from '@/services/airtable/mutations-imports'
import type { RemoteIndex } from '@/services/airtable/reads-imports'
import type {
  ImportRunClaim,
  ImportRunOutcome,
  ImportRunProgress,
} from '@/services/airtable/to-fields-imports'
import type { RecordId } from '@/types/domain'
import type { ImportCounts, ImportPhase, ImportRun, NeedsEmailRow } from '@/types/imports'

/** Long enough for one phase's writes, shorter than the sweep's schedule. */
export const IMPORT_LEASE_MS = 120_000

export type ImportRunDeps = {
  /** Uncached. A cached row makes a resumed run act on the state of a minute ago. */
  getRun: (runId: RecordId) => Promise<ImportRun>
  claimRun: (write: ImportRunWrite, claim: ImportRunClaim) => Promise<void>
  advanceRun: (write: ImportRunWrite, progress: ImportRunProgress) => Promise<void>
  finishRun: (write: ImportRunWrite, outcome: ImportRunOutcome) => Promise<void>
  /**
   * The holder recorded on the row right now. Absent runs the engine UNFENCED, exactly
   * as the outbox drain behaves without its lease port: every write is unconditional.
   * That is a caller not yet wired up rather than a supported mode.
   */
  heldBy?: (runId: RecordId) => Promise<string | undefined>
  /** Uncached, and read once per invocation: the run writes into this same table. */
  loadRemoteIndex: (eventId: RecordId) => Promise<RemoteIndex>
  /**
   * bodo's own speaker rows for the event, UNCACHED, and the source the Needs-email list
   * is built from.
   *
   * A dependency rather than something the phases reach for, because it is the one read
   * whose answer decides what the run REPORTS: the list used to be derived from the
   * upstream payload, so a source that gained an address after the speakers phase had
   * already imported the speaker without one made the run claim nobody was owed a magic
   * link. Uncached for the reason `castReader` is: a cached list is a wrong list here, and
   * the run has just written into this table.
   */
  readSpeakers: (eventId: RecordId) => Promise<readonly LocalSpeaker[]>
  fetch: (request: SourceRequest, guard: RoundTripGuard) => Promise<SourceFetch>
  write: ImportWritePorts
  /** `claimOnce` from src/utils/cf.ts. The Durable Object is what makes this atomic. */
  claim: (key: string, holder: string, ttlMs: number) => Promise<{ granted: boolean }>
  /** Unique per invocation. A shared holder would grant the same run to both sweeps. */
  holder: string
  now: () => string
  /**
   * Phases to attempt this invocation, absent meaning every remaining one. A knob rather
   * than a constant because the right answer is the deployment's: a cron Worker with a CPU
   * budget it cannot exceed sets 1 and lets the schedule carry the run forward.
   */
  maxPhases?: number
}

/**
 * What one invocation did. `advanced` and `done` differ because the sweep needs to know
 * whether a run still wants another invocation, and `contended` and `fenced` are both
 * "somebody else has this" from the two different places that can be discovered.
 */
export type RunAttempt =
  | 'done'
  | 'advanced'
  | 'failed'
  | 'contended'
  | 'fenced'
  | 'terminal'
  | 'no-client'

export type ImportRunReport = {
  runId: RecordId
  attempt: RunAttempt
  /** The phases this invocation completed, in order. Empty when nothing was claimed. */
  phases: readonly ImportPhase[]
  counts: ImportCounts
  needsEmail: readonly NeedsEmailRow[]
  error?: string
}
