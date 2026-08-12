// The scheduled task-due sweep. SPK-16.
//
// The behaviours worth pinning are the ones that only show up on a real schedule: a sweep
// running every five minutes must not mail somebody every five minutes, a task that is already
// overdue when it is assigned must get one message rather than three, and a deadline that
// moves must re-arm rather than either double-send or go silent forever.

import { describe, expect, it, vi } from 'vitest'

import type { OutstandingSpeaker } from '@/features/comms/outstanding-tasks'
import {
  enqueueTaskDueReminders,
  taskDueReminderRows,
  taskReminderKey,
  taskReminderTimes,
} from '@/features/jobs/task-reminders'

const DUE = '2026-09-01T12:00:00.000Z'
const dueMs = Date.parse(DUE)
const HOUR = 60 * 60 * 1000

function behind(tasks: OutstandingSpeaker['tasks']): OutstandingSpeaker {
  return { speakerId: 'recAda', name: 'Ada Lovelace', email: 'ada@example.com', tasks }
}

const headshot = {
  title: 'Upload your headshot',
  dueLabel: 'Due Sep 1, 2026',
  dueAt: DUE,
  assignmentId: 'assignA',
}

const base = {
  eventId: 'recEvent',
  eventName: 'AI Engineer Sandbox',
  portalUrl: 'https://bodo.example.com/portal',
}

describe('taskReminderTimes', () => {
  it('offers three days, 24 hours, and the due instant itself', () => {
    expect(taskReminderTimes(DUE).map((entry) => entry.hoursBefore)).toEqual([72, 24, 0])
  })

  it('returns instants in the past, so a deadline moved closer is still chased', () => {
    // Deliberately the same behaviour `draftReminderTimes` has. Refusing to look backwards
    // would mean a task pulled forward is never chased at all.
    const times = taskReminderTimes(DUE)
    expect(times.every((entry) => Date.parse(entry.sendAt) <= dueMs)).toBe(true)
  })

  it('returns nothing for an unparseable date rather than throwing the sweep', () => {
    expect(taskReminderTimes('not a date')).toEqual([])
  })
})

describe('taskReminderKey', () => {
  it('is per assignment, per deadline, per offset', () => {
    expect(taskReminderKey({ assignmentId: 'assignA', dueAt: DUE, hoursBefore: 24 })).toBe(
      'task-due:assignA:2026-09-01T12:00:00.000Z:24',
    )
  })

  it('changes when the deadline moves, which re-arms the reminder', () => {
    expect(taskReminderKey({ assignmentId: 'assignA', dueAt: DUE, hoursBefore: 24 })).not.toBe(
      taskReminderKey({
        assignmentId: 'assignA',
        dueAt: '2026-09-08T12:00:00.000Z',
        hoursBefore: 24,
      }),
    )
  })
})

describe('taskDueReminderRows', () => {
  it('queues nothing while every reminder is still in the future', () => {
    expect(
      taskDueReminderRows({
        ...base,
        outstanding: [behind([headshot])],
        nowMs: dueMs - 96 * HOUR,
      }),
    ).toEqual([])
  })

  it('names the task and its due date in the message', () => {
    const [row] = taskDueReminderRows({
      ...base,
      outstanding: [behind([headshot])],
      nowMs: dueMs - 23 * HOUR,
    })

    expect(row.payload.html).toContain('Upload your headshot')
    expect(row.payload.html).toContain('Due Sep 1, 2026')
    expect(row.toEmail).toBe('ada@example.com')
    expect(row.speakerId).toBe('recAda')
    expect(row.templateSource).toBe('system')
  })

  it('advances one stage at a time, so a sweep every five minutes mails once', () => {
    const at = (offsetHours: number) =>
      taskDueReminderRows({
        ...base,
        outstanding: [behind([headshot])],
        nowMs: dueMs - offsetHours * HOUR,
      })

    // Two sweeps inside the same stage compute the same key, which `enqueueEmails` skips.
    expect(at(71)[0].idempotencyKey).toBe(at(30)[0].idempotencyKey)
    expect(at(71)[0].idempotencyKey).toBe('task-due:assignA:2026-09-01T12:00:00.000Z:72')
    // Crossing into the next stage is a genuinely new message.
    expect(at(23)[0].idempotencyKey).toBe('task-due:assignA:2026-09-01T12:00:00.000Z:24')
  })

  it('sends ONE message for a task that is already overdue, not one per passed offset', () => {
    // The case that separates this from `draftReminderRows`: a task is assigned by hand,
    // routinely with a deadline that has already gone, and emitting every passed offset
    // would put three emails in one inbox in the same minute for one upload.
    const rows = taskDueReminderRows({
      ...base,
      outstanding: [behind([headshot])],
      nowMs: dueMs + 48 * HOUR,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].idempotencyKey).toBe('task-due:assignA:2026-09-01T12:00:00.000Z:0')
  })

  it('stamps the reminder instant, not now, so a backlog does not look on time', () => {
    const [row] = taskDueReminderRows({
      ...base,
      outstanding: [behind([headshot])],
      nowMs: dueMs - 20 * HOUR,
    })

    expect(row.sendAt).toBe(new Date(dueMs - 24 * HOUR).toISOString())
  })

  it('ignores a task with no deadline, because there is nothing to be due', () => {
    expect(
      taskDueReminderRows({
        ...base,
        outstanding: [behind([{ title: 'Confirm your session', assignmentId: 'assignB' }])],
        nowMs: dueMs,
      }),
    ).toEqual([])
  })
})

describe('enqueueTaskDueReminders', () => {
  const load = () =>
    Promise.resolve({ eventName: base.eventName, outstanding: [behind([headshot])] })

  it('does not write at all when nothing is due, which is most sweeps', async () => {
    const enqueue = vi.fn()

    const result = await enqueueTaskDueReminders({
      eventId: base.eventId,
      portalUrl: base.portalUrl,
      nowMs: dueMs - 96 * HOUR,
      load,
      enqueue,
    })

    expect(enqueue).not.toHaveBeenCalled()
    expect(result).toEqual({ queued: 0, skipped: 0 })
  })

  it('hands the due rows to the enqueue and reports what it returned', async () => {
    const enqueue = vi.fn().mockResolvedValue({ queued: 1, skipped: 0 })

    const result = await enqueueTaskDueReminders({
      eventId: base.eventId,
      portalUrl: base.portalUrl,
      nowMs: dueMs - 20 * HOUR,
      load,
      enqueue,
    })

    expect(result).toEqual({ queued: 1, skipped: 0 })
    expect(enqueue).toHaveBeenCalledTimes(1)
  })
})
