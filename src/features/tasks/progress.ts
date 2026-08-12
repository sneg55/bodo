// Per-speaker onboarding progress: the "1/3 done" in SPEC.md R6's acceptance criterion.
//
// SPEC.md line 44 defers dashboard analytics and charts, so this produces a table of
// rows, not a chart series. What it has to get right is the arithmetic, and every case
// below was a wrong answer waiting to happen:
//
//   - A speaker with nothing assigned reads `0/0` at 0 per cent, not `NaN%`.
//   - Two rows for the same (task, speaker, submission) are ONE to-do. Airtable has no
//     unique constraint, so `planAssignments` is the only thing stopping a duplicate and
//     a row written directly in the base would otherwise inflate the denominator to 4/4
//     on a three-task checklist.
//   - An assignment whose task record is gone is already dropped upstream by `taskItems`
//     (reads-portal.ts). An assignment whose SPEAKER is gone is dropped here, because the
//     scopes are the roster and a row pointing outside it has nobody to be progress for.
//
// Pure, and tested in tests/tasks-progress.test.ts.

import { dedupeAssignments } from '@/features/portal/task-groups'
import { type SpeakerScope, speakerDisplayName } from '@/features/tasks/scope'
import type { TaskAssignmentItem } from '@/services/airtable/reads-portal'
import type { RecordId } from '@/types/domain'

export type SpeakerProgressRow = {
  speakerId: RecordId
  name: string
  email: string
  /** Distinct to-dos assigned to this speaker. */
  assigned: number
  done: number
  outstanding: number
  /** `1/3`, which is the string the acceptance criterion names. */
  label: string
  /** 0 to 100, rounded. 0 rather than NaN when nothing is assigned. */
  percent: number
  /** The titles still outstanding, so the table can say what is missing. */
  outstandingTitles: readonly string[]
}

export function speakerProgress(input: {
  scopes: readonly SpeakerScope[]
  items: readonly TaskAssignmentItem[]
}): readonly SpeakerProgressRow[] {
  const bySpeaker = groupBySpeaker(dedupeAssignments(input.items))

  return input.scopes.map((scope) => {
    const deduped = bySpeaker.get(scope.speaker.id) ?? []
    const done = deduped.filter((entry) => entry.done).length

    return {
      speakerId: scope.speaker.id,
      name: speakerDisplayName(scope.speaker),
      email: scope.speaker.email,
      assigned: deduped.length,
      done,
      outstanding: deduped.length - done,
      label: `${done}/${deduped.length}`,
      percent: deduped.length === 0 ? 0 : Math.round((done / deduped.length) * 100),
      outstandingTitles: deduped
        .filter((entry) => !entry.done)
        .map((entry) => entry.title)
        .sort((left, right) => left.localeCompare(right)),
    }
  })
}

type Deduped = { done: boolean; title: string }

/**
 * Already-deduplicated items, bucketed by speaker.
 *
 * The tuple dedup itself moved to `dedupeAssignments`, which is now the single rule the
 * admin card, this table and the speaker's own portal list all share: they each had their
 * own before, and disagreed. This function only does the per-speaker split.
 */
function groupBySpeaker(
  items: readonly TaskAssignmentItem[],
): ReadonlyMap<RecordId, readonly Deduped[]> {
  const bySpeaker = new Map<RecordId, Deduped[]>()

  for (const item of items) {
    const forSpeaker = bySpeaker.get(item.assignment.speakerId) ?? []
    forSpeaker.push({ done: item.assignment.status === 'done', title: item.task.title })
    bySpeaker.set(item.assignment.speakerId, forSpeaker)
  }

  return bySpeaker
}

/** The "has outstanding" filter BUILD_SPEC 5.6 asks for. */
export function withOutstanding(
  rows: readonly SpeakerProgressRow[],
): readonly SpeakerProgressRow[] {
  return rows.filter((row) => row.outstanding > 0)
}

/** The one-line summary above the table. */
export function progressTotals(rows: readonly SpeakerProgressRow[]): {
  speakers: number
  assigned: number
  done: number
  complete: number
} {
  return {
    speakers: rows.length,
    assigned: rows.reduce((total, row) => total + row.assigned, 0),
    done: rows.reduce((total, row) => total + row.done, 0),
    // A speaker with nothing assigned is not "complete": there is no checklist to have
    // finished, and counting them would report a roster as onboarded before it was.
    complete: rows.filter((row) => row.assigned > 0 && row.outstanding === 0).length,
  }
}
