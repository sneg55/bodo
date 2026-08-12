// The scheduled half of the deliverables reminder: task due dates, swept. SPK-16.
//
// There WAS a reminder sweep and it reminded about the wrong thing. `reminders.ts` queues
// submission DRAFT reminders keyed off a FORM's close date ("your submission is still a draft,
// and the form closes in 24 hours"), which is the CFP deadline. Nothing looked at
// `Tasks.dueAt`, so a speaker with a headshot due tomorrow heard nothing until an organizer
// pressed a button. This is that missing sweep, and it is deliberately a SEPARATE module wired
// alongside the draft one rather than a branch inside it: the two answer to different tables,
// different deadlines and different recipients, and the draft path's behaviour is pinned by
// tests that should not move because this shipped.
//
// It shares its BODY with the organizer's manual nudge (`features/comms/task-reminder.ts`), so
// a speaker who is chased by the schedule and a speaker who is chased by hand read the same
// email. Two copies of that wording is how the automated one comes to omit the due date.
//
// Nothing sends inline. Rows are built and returned; `enqueueEmails` upserts them on
// `idempotencyKey` and the drain in the same sweep sends them, which is what puts an automated
// reminder in Email history exactly like every other message. BUILD_SPEC 5.3.
//
// Pure, and tested in tests/task-due-reminders.test.ts.

import type { OutstandingSpeaker, OutstandingTask } from '@/features/comms/outstanding-tasks'
import { taskReminderEmail } from '@/features/comms/task-reminder'
import type { EnqueueCount } from '@/features/jobs/reminders'
import type { OutboxDraft } from '@/services/airtable/to-fields-portal'
import type { RecordId } from '@/types/domain'

/**
 * How long before a task is due a speaker hears about it, and the overdue nudge.
 *
 * Three days and 24 hours mirror `DRAFT_REMINDER_HOURS` from BUILD_SPEC 5.3, because a
 * speaker should not have to learn two different rhythms for the two deadlines this product
 * gives them. `0` is the extra one and it is the overdue case the acceptance criterion names:
 * it fires at the due instant and, because a past instant is still returned, it is what a task
 * that is ALREADY overdue when it is assigned gets.
 */
export const TASK_REMINDER_HOURS: readonly number[] = [72, 24, 0]

/** How each offset reads to a speaker. Only used for the label in the log, not in the body. */
const OFFSET_LABELS = new Map<number, string>([
  [72, 'three days'],
  [24, '24 hours'],
  [0, 'due'],
])

export function taskOffsetLabel(hoursBefore: number): string {
  // A Map rather than an object indexed by the number: a dynamic property read on an object
  // is the injection sink the security lint refuses, and this key comes from data.
  return OFFSET_LABELS.get(hoursBefore) ?? `${String(hoursBefore)} hours`
}

/**
 * When each reminder for one deadline is due.
 *
 * Returns instants in the PAST as well as the future, exactly as `draftReminderTimes` does and
 * for the reason its comment gives: a deadline moved CLOSER legitimately leaves a reminder
 * already due, and refusing to look backwards would mean a task pulled forward is never
 * chased at all. Filtering is the caller's job, and `taskDueReminderRows` is that caller.
 */
export function taskReminderTimes(
  dueAt: string,
): readonly { hoursBefore: number; sendAt: string }[] {
  const due = Date.parse(dueAt)
  if (Number.isNaN(due)) return []

  return TASK_REMINDER_HOURS.map((hoursBefore) => ({
    hoursBefore,
    sendAt: new Date(due - hoursBefore * 60 * 60 * 1000).toISOString(),
  }))
}

/**
 * Per ASSIGNMENT, per DEADLINE, per OFFSET.
 *
 * Each part earns its place. The assignment is the one to-do, so two speakers owing the same
 * task get their own reminder and one speaker owing the same task on two sessions gets one
 * each. The due date is in the key so MOVING a deadline re-arms the reminders rather than
 * suppressing them forever, which is `draftReminder`'s rule verbatim: an organizer who pushes
 * a deadline out has, by design, signed up for the speaker being chased again against the new
 * date, and an organizer who pulls it in gets the reminder they were asking for.
 *
 * The OFFSET is what stops a sweep that runs every five minutes from mailing somebody every
 * five minutes: the twelfth sweep of the hour computes the same key as the first and
 * `enqueueEmails` skips it without a write.
 */
export function taskReminderKey(input: {
  assignmentId: string
  dueAt: string
  hoursBefore: number
}): string {
  return `task-due:${input.assignmentId}:${input.dueAt}:${String(input.hoursBefore)}`
}

export type TaskDueReminderInput = {
  readonly eventId: RecordId
  readonly eventName: string
  /** Everyone still outstanding, from `outstandingTaskRows`. Undated tasks are ignored. */
  readonly outstanding: readonly OutstandingSpeaker[]
  readonly portalUrl: string
  readonly nowMs: number
}

/**
 * The most recent reminder this deadline has reached, or nothing.
 *
 * ONE row per task per sweep and not one per passed offset, which is where this deliberately
 * differs from `draftReminderRows`. That function emits every offset whose instant has passed,
 * and it is safe there because a form's close date is set long before its submissions exist,
 * so the 72 hour instant has never already gone by when the draft appears. A TASK is assigned
 * by hand, routinely with a deadline that is already close or already past, and emitting every
 * passed offset would put three emails in one speaker's inbox in the same minute for one
 * upload. Taking only the latest gives the same schedule when the sweep is healthy, one
 * message per stage, and one message rather than three when it is not.
 */
function dueStage(
  task: OutstandingTask,
  nowMs: number,
): { hoursBefore: number; sendAt: string } | undefined {
  if (task.dueAt === undefined) return undefined

  return taskReminderTimes(task.dueAt)
    .filter((entry) => Date.parse(entry.sendAt) <= nowMs)
    .reduce<{ hoursBefore: number; sendAt: string } | undefined>(
      (latest, entry) => (latest === undefined || entry.sendAt > latest.sendAt ? entry : latest),
      undefined,
    )
}

/** One row per outstanding task whose next reminder has come due. */
export function taskDueReminderRows(input: TaskDueReminderInput): readonly OutboxDraft[] {
  return input.outstanding.flatMap((speaker) =>
    speaker.tasks.flatMap((task) => {
      const stage = dueStage(task, input.nowMs)
      if (stage === undefined || task.dueAt === undefined) return []

      return [
        {
          eventId: input.eventId,
          templateSource: 'system' as const,
          idempotencyKey: taskReminderKey({
            assignmentId: task.assignmentId,
            dueAt: task.dueAt,
            hoursBefore: stage.hoursBefore,
          }),
          speakerId: speaker.speakerId,
          toEmail: speaker.email,
          // The reminder instant, not now. The Comms log and the due-list both order on
          // this, and stamping it "now" would make a backlog look like it was queued on time.
          sendAt: stage.sendAt,
          payload: {
            // The SAME body the organizer's manual nudge sends, with a one-task list: it
            // names the title and the due date, which is what the acceptance criterion
            // checks, and sharing it is what stops the two paths from drifting.
            ...taskReminderEmail({
              name: speaker.name,
              eventName: input.eventName,
              tasks: [task],
              portalUrl: input.portalUrl,
            }),
            attachIcs: false,
          },
        },
      ]
    }),
  )
}

export type TaskReminderEnqueueDeps = {
  readonly eventId: RecordId
  readonly portalUrl: string
  readonly nowMs: number
  /**
   * The event's name and everyone still outstanding, in one closure.
   *
   * One dependency rather than four, because the two halves are read together and the
   * timezone that formats a due label comes off the same event record that supplies the name:
   * splitting them would let a caller format dates in one zone and title the email from
   * another. The wiring resolves this against the DAL; a test hands it a literal.
   */
  readonly load: () => Promise<{
    eventName: string
    outstanding: readonly OutstandingSpeaker[]
  }>
  /** Upserts on `idempotencyKey`, so a repeated sweep writes nothing. */
  readonly enqueue: (rows: readonly OutboxDraft[]) => Promise<EnqueueCount>
}

/**
 * Queue the task reminders that have come due.
 *
 * Nothing here tracks what it has already sent and it does not need to: the key is a function
 * of the assignment, the deadline and the offset, so the twelfth sweep of the hour computes
 * the same key as the first and the enqueue recognises it.
 *
 * No write at all when nothing is due, which is the normal case on most sweeps.
 */
export async function enqueueTaskDueReminders(
  deps: TaskReminderEnqueueDeps,
): Promise<EnqueueCount> {
  const { eventName, outstanding } = await deps.load()

  const rows = taskDueReminderRows({
    eventId: deps.eventId,
    eventName,
    outstanding,
    portalUrl: deps.portalUrl,
    nowMs: deps.nowMs,
  })

  if (rows.length === 0) return { queued: 0, skipped: 0 }
  return await deps.enqueue(rows)
}
