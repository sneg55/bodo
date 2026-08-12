// The deliverables reminder body and its rows. CNT-08.
//
// The acceptance criterion is specific: the message has to name the outstanding task AND its
// due date. That is what most of this file asserts, because a reminder that says "you have
// three tasks outstanding" and nothing else is a reminder the speaker cannot act on.

import { describe, expect, it } from 'vitest'

import type { OutstandingSpeaker } from '@/features/comms/outstanding-tasks'
import {
  taskReminderEmail,
  taskReminderKey,
  taskReminderRows,
} from '@/features/comms/task-reminder'

const ada: OutstandingSpeaker = {
  speakerId: 'recAda',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  tasks: [
    { title: 'Upload your headshot', dueLabel: 'Due Aug 20, 2026', assignmentId: 'a1' },
    { title: 'Confirm your session', assignmentId: 'a2' },
  ],
}

const base = {
  eventId: 'recEvent',
  eventName: 'AI Engineer Sandbox',
  portalUrl: 'https://bodo.example.com/portal',
  now: '2026-08-10T09:00:00.000Z',
}

describe('taskReminderEmail', () => {
  it('names every outstanding task and its due date', () => {
    const message = taskReminderEmail({
      name: 'Ada',
      eventName: base.eventName,
      tasks: ada.tasks,
      portalUrl: base.portalUrl,
    })

    expect(message.html).toContain('Upload your headshot')
    expect(message.html).toContain('Due Aug 20, 2026')
    expect(message.html).toContain('Confirm your session')
    expect(message.html).toContain(base.portalUrl)
  })

  it('says so rather than rendering a bare title when a task has no deadline', () => {
    // A list of five where two silently lack a date reads as though the dates failed to load.
    const message = taskReminderEmail({
      name: 'Ada',
      eventName: base.eventName,
      tasks: [{ title: 'Confirm your session', assignmentId: 'a2' }],
      portalUrl: base.portalUrl,
    })

    expect(message.html).toContain('No due date')
  })

  it('counts in the subject and in the body, singular and plural', () => {
    const one = taskReminderEmail({
      name: 'Ada',
      eventName: base.eventName,
      tasks: [ada.tasks[0]],
      portalUrl: base.portalUrl,
    })
    const two = taskReminderEmail({
      name: 'Ada',
      eventName: base.eventName,
      tasks: ada.tasks,
      portalUrl: base.portalUrl,
    })

    expect(one.subject).toBe('AI Engineer Sandbox: 1 task still outstanding')
    expect(two.subject).toBe('AI Engineer Sandbox: 2 tasks still outstanding')
    // In the body too: a speaker who has finished most of their checklist reads a bare "you
    // have tasks outstanding" as a mistake.
    expect(two.html).toContain('2 tasks still outstanding')
  })

  it('escapes a task title, which is the one part of the body it does not author', () => {
    const message = taskReminderEmail({
      name: 'Ada',
      eventName: base.eventName,
      tasks: [{ title: '<script>alert(1)</script>', assignmentId: 'a3' }],
      portalUrl: base.portalUrl,
    })

    expect(message.html).not.toContain('<script>')
    expect(message.html).toContain('&lt;script&gt;')
  })
})

describe('taskReminderKey', () => {
  it('is per speaker per day, so a second press in a morning queues nothing', () => {
    expect(taskReminderKey('recAda', '2026-08-10T09:00:00.000Z')).toBe(
      taskReminderKey('recAda', '2026-08-10T17:30:00.000Z'),
    )
  })

  it('changes the next day, so chasing again three days later sends', () => {
    expect(taskReminderKey('recAda', '2026-08-10T09:00:00.000Z')).not.toBe(
      taskReminderKey('recAda', '2026-08-13T09:00:00.000Z'),
    )
  })
})

describe('taskReminderRows', () => {
  it('builds one row per recipient, carrying the speaker link and the batch instant', () => {
    const [row] = taskReminderRows({ ...base, recipients: [ada] })

    expect(row.toEmail).toBe('ada@example.com')
    // Carried so `enqueueEmails` expires this person's CRM timeline as well as the event's
    // Email history.
    expect(row.speakerId).toBe('recAda')
    expect(row.sendAt).toBe(base.now)
    expect(row.templateSource).toBe('system')
    expect(row.idempotencyKey).toBe('task-remind:recAda:2026-08-10')
    expect(row.payload.attachIcs).toBe(false)
    expect(row.payload.html).toContain('Due Aug 20, 2026')
  })

  it('leaves no unresolved merge token in what goes out', () => {
    const [row] = taskReminderRows({ ...base, recipients: [ada] })

    expect(row.payload.html).not.toContain('{{')
    expect(row.payload.subject).not.toContain('{{')
  })
})
