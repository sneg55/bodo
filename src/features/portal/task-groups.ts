// How the portal partitions a speaker's task assignments.
//
// Refs 17-18 show three tabs (`All`, `My Tasks (n)`, `Submissions (n)`) over two
// sections (`Submission Tasks`, `My Tasks`), which is one partition rendered twice.
// BUILD_SPEC 5.6 names the rule: "Contact-typed items surface in the portal's My
// Tasks; Submission-typed items under the specific submission's tasks."
//
// `group` is the third `TaskEntityType` and it falls in with contact rather than
// getting a section of its own, because there are two sections in the screenshot and
// a group task is still something the person has to do rather than something a
// session has to have.

import { dedupeByTuple } from '@/features/assignments/dedupe'
import type { PortalTaskItem } from '@/features/portal/ports'
import type { RecordId } from '@/types/domain'

export type TaskFilter = 'all' | 'outstanding' | 'completed'

export type TaskGrouping = {
  /** Contact and group scoped. The `My Tasks` section and tab. */
  mine: readonly PortalTaskItem[]
  /** Submission scoped. The `Submission Tasks` section and the `Submissions` tab. */
  submission: readonly PortalTaskItem[]
}

export function groupTasks(items: readonly PortalTaskItem[]): TaskGrouping {
  // Deduplicated first. Without it a duplicate assignment row showed the speaker the same
  // to-do twice, and the admin dashboard could read them as Complete off one of the two
  // while their own list still had the other pending. See `dedupeAssignments`.
  const unique = dedupeAssignments(items)
  return {
    mine: unique.filter((item) => item.task.entityType !== 'submission'),
    submission: unique.filter((item) => item.task.entityType === 'submission'),
  }
}

/** The submission-scoped assignments for one submission. Used by the detail page. */
export function tasksForSubmission(
  items: readonly PortalTaskItem[],
  submissionId: RecordId,
): readonly PortalTaskItem[] {
  return dedupeAssignments(items).filter(
    (item) =>
      item.task.entityType === 'submission' && item.assignment.submissionId === submissionId,
  )
}

export function applyTaskFilter(
  items: readonly PortalTaskItem[],
  filter: TaskFilter,
): readonly PortalTaskItem[] {
  if (filter === 'outstanding') return items.filter((item) => item.assignment.status !== 'done')
  if (filter === 'completed') return items.filter((item) => item.assignment.status === 'done')
  return items
}

/**
 * The numbers in the tab labels.
 *
 * Every assignment counts, done or not. The screenshot shows both counts at 0 with no
 * tasks at all, so it settles nothing, and a count that shrinks as a speaker finishes
 * work would disagree with the section it labels, which still lists the completed
 * rows. Outstanding work is what the `Filter` control is for.
 */
export function taskCounts(grouping: TaskGrouping): { mine: number; submission: number } {
  return { mine: grouping.mine.length, submission: grouping.submission.length }
}

/**
 * One entry per (task, speaker, submission) tuple, with a completed row winning.
 *
 * Airtable has no unique constraint, so two assignment rows CAN describe the same to-do: a
 * concurrent assign, or a row added by hand. Three surfaces read these items and each
 * deduplicated differently, which is the actual bug rather than the duplicates themselves.
 * `speakerProgress` merged with done-wins, the admin task card kept whichever row Airtable
 * returned first, and the portal list deduplicated not at all. So completing one of two
 * duplicate rows could report a speaker `1/1` and "Complete" on the dashboard while their
 * own portal still listed the other row as pending, and the card read `0/1` or `1/1`
 * depending on row order. Found by Codex review.
 *
 * Done wins because the speaker did the thing, and chasing them for work already delivered
 * is the worse failure on a surface whose whole purpose is deciding who to chase.
 */
export function dedupeAssignments<
  T extends {
    task: { id: string }
    assignment: { speakerId: string; submissionId?: string; status: string }
  },
>(items: readonly T[]): readonly T[] {
  return dedupeByTuple(
    items,
    (item) => `${item.task.id}|${item.assignment.speakerId}|${item.assignment.submissionId ?? ''}`,
    (item) => item.assignment.status === 'done',
  )
}
