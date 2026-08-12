// The deliverables reminder body and its rows. CNT-08.
//
// The acceptance criterion is specific: the organizer triggers it in bulk, the message names
// the outstanding request AND its due date, and the send is confirmed. The first and the third
// are the button and the action; this file pins the second, plus the idempotency key that
// stops a second press from mailing everybody twice.

import { describe, expect, it } from 'vitest'

import {
  fileReminderEmail,
  fileReminderKey,
  fileReminderRows,
} from '@/features/comms/file-reminder'
import { taskReminderKey } from '@/features/comms/task-reminder'
import type { OutstandingFileSpeaker } from '@/features/files/outstanding-deliverables'

const ada: OutstandingFileSpeaker = {
  speakerId: 'recAda',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  deliverables: [
    {
      title: 'Signed speaker release',
      dueLabel: 'Due Aug 1, 2026',
      dueAt: '2026-08-01T23:59:59.000Z',
      required: true,
      overdue: true,
    },
    { title: 'Bio as a document', required: false, overdue: false },
  ],
}

const base = {
  eventId: 'recEvent',
  eventName: 'AI Engineer Sandbox',
  portalUrl: 'https://bodo.example.com/portal',
  now: '2026-08-11T09:00:00.000Z',
}

describe('fileReminderEmail', () => {
  it('names every outstanding document and its due date', () => {
    const message = fileReminderEmail({
      name: 'Ada',
      eventName: base.eventName,
      deliverables: ada.deliverables,
      portalUrl: base.portalUrl,
    })

    expect(message.html).toContain('Signed speaker release')
    expect(message.html).toContain('Due Aug 1, 2026')
    expect(message.html).toContain('Bio as a document')
    expect(message.html).toContain(base.portalUrl)
  })

  it('says so rather than rendering a bare title when a request has no deadline', () => {
    // A list of five where two silently lack a date reads as though the dates failed to load.
    const message = fileReminderEmail({
      name: 'Ada',
      eventName: base.eventName,
      deliverables: [{ title: 'Bio as a document', required: false, overdue: false }],
      portalUrl: base.portalUrl,
    })

    expect(message.html).toContain('No due date')
  })

  it('says which one is already late, because a date alone leaves that to the reader', () => {
    const message = fileReminderEmail({
      name: 'Ada',
      eventName: base.eventName,
      deliverables: ada.deliverables,
      portalUrl: base.portalUrl,
    })

    expect(message.html).toContain('OVERDUE')
    expect(message.html).toContain('required')
  })

  it('counts in the subject and in the body, singular and plural', () => {
    const one = fileReminderEmail({
      name: 'Ada',
      eventName: base.eventName,
      deliverables: [ada.deliverables[0]],
      portalUrl: base.portalUrl,
    })
    const two = fileReminderEmail({
      name: 'Ada',
      eventName: base.eventName,
      deliverables: ada.deliverables,
      portalUrl: base.portalUrl,
    })

    expect(one.subject).toBe('AI Engineer Sandbox: 1 file still outstanding')
    expect(one.html).toContain('1 file')
    expect(two.subject).toBe('AI Engineer Sandbox: 2 files still outstanding')
    expect(two.html).toContain('2 files')
  })

  it('escapes an organizer-authored title, which is the whole untrusted surface', () => {
    const message = fileReminderEmail({
      name: 'Ada',
      eventName: base.eventName,
      deliverables: [{ title: '<img src=x onerror=alert(1)>', required: false, overdue: false }],
      portalUrl: base.portalUrl,
    })

    expect(message.html).not.toContain('<img')
    expect(message.html).toContain('&lt;img')
  })
})

describe('fileReminderKey', () => {
  it('is per speaker per day, so a second press the same morning queues nothing', () => {
    expect(fileReminderKey('recAda', base.now)).toBe('file-remind:recAda:2026-08-11')
    expect(fileReminderKey('recAda', '2026-08-11T18:00:00.000Z')).toBe(
      fileReminderKey('recAda', base.now),
    )
    expect(fileReminderKey('recAda', '2026-08-14T09:00:00.000Z')).not.toBe(
      fileReminderKey('recAda', base.now),
    )
  })

  it('does not collide with the task reminder, which is a different thing to be behind on', () => {
    // Sharing a key would mean chasing somebody about a late release form silently suppressed
    // the reminder about their unfinished onboarding tasks, or the other way round.
    expect(fileReminderKey('recAda', base.now)).not.toBe(taskReminderKey('recAda', base.now))
  })
})

describe('fileReminderRows', () => {
  it('builds one outbox row per recipient, keyed and addressed', () => {
    const rows = fileReminderRows({ ...base, recipients: [ada] })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.toEmail).toBe('ada@example.com')
    expect(rows[0]?.idempotencyKey).toBe('file-remind:recAda:2026-08-11')
    // Carried so the row lands in this person's CRM timeline as well as the event's history.
    expect(rows[0]?.speakerId).toBe('recAda')
    expect(rows[0]?.templateSource).toBe('system')
    expect(rows[0]?.payload.attachIcs).toBe(false)
  })
})
