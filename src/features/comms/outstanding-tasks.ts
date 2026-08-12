// Who still owes work, and exactly what they owe. CNT-08.
//
// `speakerProgress` in features/tasks/progress.ts already computes who is behind, and it is
// deliberately not reused whole: it flattens each outstanding item to a TITLE, because the
// Onboarding status table only ever prints two of them and a count. A reminder has to name
// the task AND its due date, so this walks the same assignments and keeps the deadline.
//
// The two functions agree by construction on the part that matters, because both start from
// `dedupeAssignments`: a duplicate assignment row (Airtable has no unique constraint) is one
// to-do in the table, one to-do in the speaker's own portal list, and one line in the
// reminder. Without that a speaker could be chased about the same upload twice in one email.
//
// A speaker with no address on file is DROPPED here rather than at the sender, because they
// are not somebody who can be reminded: leaving them in would make the confirmation count
// people who were never going to be mailed.
//
// Pure, and tested in tests/comms-outstanding-tasks.test.ts.

import { dedupeAssignments } from '@/features/portal/task-groups'
import { formatDue } from '@/features/portal/task-view'
import { type SpeakerScope, speakerDisplayName } from '@/features/tasks/scope'
import type { TaskAssignmentItem } from '@/services/airtable/reads-portal'
import type { RecordId } from '@/types/domain'

export type OutstandingTask = {
  readonly title: string
  /** `Due Mar 3, 2026`, in the event's timezone. Absent when the task has no deadline. */
  readonly dueLabel?: string
  /** The raw instant, for ordering and for the due-date sweep's idempotency key. */
  readonly dueAt?: string
  /**
   * The `TaskAssignments` row this line is, which is what makes ONE to-do addressable.
   *
   * Carried for the scheduled sweep (features/jobs/task-reminders.ts), which keys a reminder
   * per assignment per offset. The manual bulk nudge does not read it: that one is keyed per
   * speaker per day and names the whole list in one message.
   */
  readonly assignmentId: RecordId
}

export type OutstandingSpeaker = {
  readonly speakerId: RecordId
  readonly name: string
  readonly email: string
  /** Never empty: a speaker with nothing outstanding is not in the list at all. */
  readonly tasks: readonly OutstandingTask[]
}

/**
 * One entry per accepted speaker who still owes something, soonest deadline first.
 *
 * Sorted by due date with the undated LAST, matching `taskItems` in reads-portal.ts and the
 * portal's own list, so the order a speaker reads in the reminder is the order they will see
 * when the link takes them there. A task with no deadline is never the thing they have to do
 * next, so it sorts last rather than first.
 */
export function outstandingTaskRows(input: {
  scopes: readonly SpeakerScope[]
  items: readonly TaskAssignmentItem[]
  /** The event's timezone, so a due date reads the same here and in the portal. */
  timeZone: string
}): readonly OutstandingSpeaker[] {
  const bySpeaker = new Map<RecordId, OutstandingTask[]>()

  for (const item of dedupeAssignments(input.items)) {
    if (item.assignment.status === 'done') continue
    const forSpeaker = bySpeaker.get(item.assignment.speakerId) ?? []
    const dueLabel = formatDue(item.task.dueAt, input.timeZone)
    forSpeaker.push({
      title: item.task.title,
      assignmentId: item.assignment.id,
      ...(dueLabel === undefined ? {} : { dueLabel }),
      ...(item.task.dueAt === undefined ? {} : { dueAt: item.task.dueAt }),
    })
    bySpeaker.set(item.assignment.speakerId, forSpeaker)
  }

  return input.scopes.flatMap((scope) => {
    const tasks = bySpeaker.get(scope.speaker.id) ?? []
    if (tasks.length === 0) return []
    if (scope.speaker.email.trim() === '') return []

    return [
      {
        speakerId: scope.speaker.id,
        name: speakerDisplayName(scope.speaker),
        email: scope.speaker.email.trim(),
        tasks: [...tasks].sort(byDueThenTitle),
      },
    ]
  })
}

function byDueThenTitle(left: OutstandingTask, right: OutstandingTask): number {
  if (left.dueAt !== right.dueAt) {
    if (left.dueAt === undefined) return 1
    if (right.dueAt === undefined) return -1
    return left.dueAt.localeCompare(right.dueAt)
  }
  return left.title.localeCompare(right.title)
}

/**
 * The rows an organizer's selection actually targets.
 *
 * The ids are a FILTER, never a recipient list, for the reason `bulk-recipients.ts` gives:
 * a Server Action is reachable by POST, so recomputing who is behind means the worst a forged
 * call can do is send the reminder the organizer could have sent anyway. An EMPTY selection
 * means everybody who is behind, which is what the button on the Onboarding status header
 * does, and it is safe here in a way it is not on the roster: the set is not "everyone", it is
 * "everyone this surface has just shown you is behind".
 */
export function selectedOutstanding(
  rows: readonly OutstandingSpeaker[],
  speakerIds: readonly RecordId[],
): readonly OutstandingSpeaker[] {
  if (speakerIds.length === 0) return rows
  const picked = new Set(speakerIds)
  return rows.filter((row) => picked.has(row.speakerId))
}
