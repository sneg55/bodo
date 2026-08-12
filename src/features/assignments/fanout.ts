// The uniqueness-tuple fan-out, shared by task assignments and file request assignments.
//
// BUILD_SPEC 3 makes `TaskAssignments` unique on `(task, speaker, submission)` and
// `FileRequestAssignments` unique on `(fileRequest, speaker, submission)`. That is one rule
// over two tables, so it is one planner: `@/features/tasks/plan` and
// `@/features/file-requests/plan` are both thin adapters over this and neither holds a
// second copy of the arithmetic. A second copy would be worse than sharing, because the two
// would drift on the case that is expensive to see through a UI (a speaker with three
// accepted submissions gets three rows for one submission-scoped definition, and closing
// one of them must not close the others).
//
// Idempotent by construction: a tuple that already has a row is skipped, which is what
// makes pressing Assign twice a no-op rather than a duplicated checklist. Airtable has no
// unique constraint, so this function is the only thing standing between an organizer's
// second click and a doubled denominator on every progress table.
//
// Pure, and tested in tests/tasks-plan.test.ts and tests/file-requests-plan.test.ts.

import type { TaskEntityType } from '@/constants/status'
import type { RecordId } from '@/types/domain'

/** A task or a file request: an id, and who it is addressed to. */
export type FanoutDefinition = { id: RecordId; entityType: TaskEntityType }

/**
 * One speaker and the accepted submissions they are on.
 *
 * Structural rather than an import of `SpeakerScope` from `@/features/tasks/scope`, so this
 * module depends on no feature: `acceptedSpeakerScopes` produces a value that satisfies it,
 * and both callers pass that value straight through.
 */
export type FanoutScope = {
  speaker: { id: RecordId }
  submissionIds: readonly RecordId[]
}

export type FanoutRow = {
  definitionId: RecordId
  speakerId: RecordId
  /** Set only for a submission-scoped definition. */
  submissionId?: RecordId
}

/**
 * The uniqueness tuple as one string.
 *
 * An absent submission collapses to an empty segment rather than being omitted, so
 * `(def, speaker, undefined)` and `(def, speaker, 'recX')` can never collide, and a record
 * id cannot be misread as a different tuple because `|` is not legal in an Airtable id.
 */
export function tupleKey(row: FanoutRow): string {
  return `${row.definitionId}|${row.speakerId}|${row.submissionId ?? ''}`
}

export type FanoutPlan = {
  /** Rows to create, in a stable order: definition, then speaker, then submission. */
  create: readonly FanoutRow[]
  /** Tuples that already had a row. Reported so the UI can say "already assigned". */
  skipped: number
}

export function planFanout(input: {
  definitions: readonly FanoutDefinition[]
  scopes: readonly FanoutScope[]
  existing: readonly FanoutRow[]
}): FanoutPlan {
  const seen = new Set(input.existing.map(tupleKey))
  const create: FanoutRow[] = []
  let skipped = 0

  for (const definition of input.definitions) {
    for (const scope of input.scopes) {
      for (const planned of rowsFor(definition, scope)) {
        const key = tupleKey(planned)
        if (seen.has(key)) {
          skipped += 1
          continue
        }
        // Added to the same set the existing rows went into, so a duplicate WITHIN one run
        // is skipped on exactly the rule that skips a duplicate across runs.
        seen.add(key)
        create.push(planned)
      }
    }
  }

  return { create, skipped }
}

/**
 * One definition against one speaker.
 *
 * A submission-scoped definition for a speaker with no accepted submission yields NOTHING
 * rather than a row with an empty submission link. That combination cannot arise from
 * `acceptedSpeakerScopes`, which builds every scope out of an accepted submission, and it
 * is refused here anyway: such a row would be filed under a session that does not exist,
 * and the speaker would never see it.
 */
function rowsFor(definition: FanoutDefinition, scope: FanoutScope): readonly FanoutRow[] {
  if (definition.entityType !== 'submission') {
    return [{ definitionId: definition.id, speakerId: scope.speaker.id }]
  }
  return scope.submissionIds.map((submissionId) => ({
    definitionId: definition.id,
    speakerId: scope.speaker.id,
    submissionId,
  }))
}
