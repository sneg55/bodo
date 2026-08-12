// The bulk composer's row builder, its merge-gap report and its idempotency key. SPK-13.
//
// Three things here are worth a test each because each is a way the composer sends something
// other than what the organizer read: a merge field that resolves for some recipients and not
// others, a subject that arrives HTML-escaped, and a double press that mails everybody twice.

import { describe, expect, it } from 'vitest'

import { bulkEmailRows, bulkSendId, mergeFieldProblems } from '@/features/comms/bulk-compose'
import type { BulkRecipient } from '@/features/comms/bulk-recipients'

const ada: BulkRecipient = {
  speakerId: 'recAda',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  company: 'Analytical Engines',
}

const nameless: BulkRecipient = {
  speakerId: 'recAnon',
  email: 'anon@example.com',
  firstName: '',
  lastName: '',
}

const base = {
  eventId: 'recEvent',
  event: { name: 'AI & ML Summit', slug: 'ai-ml-summit' },
  portalUrl: 'https://bodo.example.com/portal',
  sendAt: '2026-08-10T09:00:00.000Z',
  sendId: '2026-08-10:abc',
}

describe('bulkEmailRows', () => {
  it('renders one row per recipient, keyed per send and per speaker', () => {
    const rows = bulkEmailRows({
      ...base,
      recipients: [ada, nameless],
      subject: 'Travel details',
      bodyHtml: '<p>Hi {{speaker.firstName}}, see you at {{event.name}}.</p>',
    })

    expect(rows).toHaveLength(2)
    expect(rows[0].idempotencyKey).toBe('cohort:2026-08-10:abc:recAda')
    expect(rows[1].idempotencyKey).toBe('cohort:2026-08-10:abc:recAnon')
    expect(rows[0].kind).toBe('cohort.custom')
    expect(rows[0].speakerId).toBe('recAda')
    expect(rows[0].sendAt).toBe(base.sendAt)
    expect(rows[0].payload.html).toContain('Hi Ada,')
    // The nameless row degrades rather than throwing, which is the whole point: a roster
    // imported from a spreadsheet of addresses is the ordinary case for a bulk send.
    expect(rows[1].payload.html).toContain('Hi there,')
  })

  it('does not HTML-escape the subject, and does escape the body', () => {
    const [row] = bulkEmailRows({
      ...base,
      recipients: [ada],
      subject: '{{event.name}} logistics',
      bodyHtml: '<p>{{event.name}}</p>',
    })

    // A subject is a mail header, so "AI & ML Summit" must not arrive as "AI &amp; ML Summit".
    expect(row.payload.subject).toBe('AI & ML Summit logistics')
    // A body is markup, and every merged value is escaped on the way in.
    expect(row.payload.html).toContain('AI &amp; ML Summit')
  })

  it('is stamped `system` even when the draft began as a template', () => {
    // The body was edited after it was picked, so no stored row can be pointed at as the
    // thing that was sent. The Comms log naming a template the mail did not come from is
    // worse than it saying the message was composed by hand.
    const [row] = bulkEmailRows({
      ...base,
      recipients: [ada],
      subject: 'Anything',
      bodyHtml: '<p>Anything</p>',
    })

    expect(row.templateSource).toBe('system')
    expect(row.templateId).toBeUndefined()
  })

  it('throws rather than mailing a gap when a field cannot be supplied', () => {
    expect(() =>
      bulkEmailRows({
        ...base,
        recipients: [nameless],
        subject: 'Hello',
        bodyHtml: '<p>{{speaker.company}}</p>',
      }),
    ).toThrowError(/E_MAIL_003|company/u)
  })
})

describe('mergeFieldProblems', () => {
  const shared = {
    event: base.event,
    portalUrl: base.portalUrl,
    subject: 'Hello',
  }

  it('reports nothing when every recipient can supply every field', () => {
    expect(
      mergeFieldProblems({
        ...shared,
        recipients: [ada, nameless],
        bodyHtml: '<p>{{speaker.firstName}} {{event.name}} {{portalUrl}}</p>',
      }),
    ).toEqual([])
  })

  it('counts the recipients a blank field would fail for, and marks it known', () => {
    const [problem] = mergeFieldProblems({
      ...shared,
      recipients: [ada, nameless],
      bodyHtml: '<p>{{speaker.company}}</p>',
    })

    expect(problem.field).toBe('speaker.company')
    expect(problem.missingFor).toBe(1)
    expect(problem.known).toBe(true)
  })

  it('marks a field outside the bulk vocabulary as unknown', () => {
    // `submission.title` is a real merge field and is deliberately not reachable from a
    // roster send, because half a roster has never submitted anything.
    const [problem] = mergeFieldProblems({
      ...shared,
      recipients: [ada],
      bodyHtml: '<p>{{submission.title}}</p>',
    })

    expect(problem.field).toBe('submission.title')
    expect(problem.known).toBe(false)
    expect(problem.missingFor).toBe(1)
  })

  it('reads the subject as well as the body', () => {
    const problems = mergeFieldProblems({
      ...shared,
      subject: '{{speaker.company}} update',
      recipients: [nameless],
      bodyHtml: '<p>Hello</p>',
    })

    expect(problems.map((problem) => problem.field)).toEqual(['speaker.company'])
  })
})

describe('bulkSendId', () => {
  const message = { subject: 'Travel details', bodyHtml: '<p>Book by Friday</p>' }

  it('is stable for the same message on the same day, so a double press queues once', () => {
    expect(bulkSendId({ ...message, nowIso: '2026-08-10T09:00:00.000Z' })).toBe(
      bulkSendId({ ...message, nowIso: '2026-08-10T17:45:12.000Z' }),
    )
  })

  it('differs the next day, so the same words can genuinely be sent again', () => {
    expect(bulkSendId({ ...message, nowIso: '2026-08-10T09:00:00.000Z' })).not.toBe(
      bulkSendId({ ...message, nowIso: '2026-08-11T09:00:00.000Z' }),
    )
  })

  it('differs when the body changes, so a corrected message is a new message', () => {
    expect(bulkSendId({ ...message, nowIso: '2026-08-10T09:00:00.000Z' })).not.toBe(
      bulkSendId({
        subject: message.subject,
        bodyHtml: '<p>Book by Thursday</p>',
        nowIso: '2026-08-10T09:00:00.000Z',
      }),
    )
  })
})
