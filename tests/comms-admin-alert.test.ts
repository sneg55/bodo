// The two admin alerts, and the proof that a stored template is what actually gets sent.
//
// The unit under test is the row builder, because the row IS the mail: `payloadJson` is a
// snapshot taken at enqueue time and the drain sends `row.payload` verbatim (drain.ts), so a
// body that reaches this row reaches the recipient. That is what makes these assertions
// evidence rather than a proxy for it.
//
// tests/portal-update-alert.test.ts covers the update alert's keys and dedupe through its own
// entry point. This file is about the half that is new: which BODY is chosen, and what the row
// then claims about where it came from.

import { describe, expect, it } from 'vitest'

import { adminAlertRows, adminAlertTemplateKey } from '@/features/comms/admin-alert'
import { TEMPLATE_KEYS } from '@/features/comms/template-keys'
import { idempotencyKeys } from '@/features/comms/triggers'
import type { EmailTemplate } from '@/types/domain'

const AT = '2026-08-08T12:00:00.000Z'

const BASE = {
  eventId: 'recEvent1',
  eventName: 'AI & ML Summit',
  eventSlug: 'ai-ml-summit',
  submissionId: 'recSub1',
  submissionTitle: 'Evaluating agents',
  submissionCode: 'SESS-1',
  recipients: ['organizer@example.com'],
  actor: { name: 'Ada Okafor', email: 'ada@example.com' },
  at: AT,
  linkUrl: 'https://bodo.test/admin/recEvent1/abstracts',
} as const

function stored(key: string, overrides: Partial<EmailTemplate> = {}): EmailTemplate {
  return {
    id: 'recTpl1',
    eventId: 'recEvent1',
    key,
    subject: 'A submission needs you: {{submission.code}}',
    bodyMarkdown: '## Heads up\n\n{{speaker.firstName}} sent **{{submission.title}}**.',
    attachIcs: false,
    ...overrides,
  }
}

describe('the key each alert reads', () => {
  it('maps the two alerts to the two custom keys the panel edits', () => {
    // The join between the editor and the sender. A key spelled twice is an editor that
    // writes a row nothing reads, and that failure is invisible: the save succeeds.
    expect(adminAlertTemplateKey('new')).toBe(TEMPLATE_KEYS.adminNew)
    expect(adminAlertTemplateKey('update')).toBe(TEMPLATE_KEYS.adminUpdate)
    expect(TEMPLATE_KEYS.adminNew).toBe('custom-admin-new')
    expect(TEMPLATE_KEYS.adminUpdate).toBe('custom-admin-update')
  })
})

describe('adminAlertRows with no stored template', () => {
  it('sends the built-in body and says so', () => {
    const [row] = adminAlertRows({ ...BASE, kind: 'new' })

    expect(row.templateSource).toBe('system')
    expect(row.templateId).toBeUndefined()
    // The catalogue default is markdown; the row carries the HTML it renders to.
    expect(row.payload.html).toContain('Ada Okafor')
    expect(row.payload.html).toContain('<strong>Evaluating agents</strong>')
    expect(row.payload.html).toContain(BASE.linkUrl)
  })

  it('renders the built-in subject through the merge context, unescaped', () => {
    const [row] = adminAlertRows({ ...BASE, kind: 'new' })
    // "AI &amp; ML Summit" in a mail header is the bug this guards.
    expect(row.payload.subject).toBe('SESS-1 was submitted to AI & ML Summit')
  })
})

describe('adminAlertRows with a stored template', () => {
  it('sends the ORGANIZER body, on every recipient row, and records the row it came from', () => {
    const rows = adminAlertRows({
      ...BASE,
      kind: 'new',
      recipients: ['first@example.com', 'second@example.com'],
      template: stored(TEMPLATE_KEYS.adminNew),
    })

    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.templateSource).toBe('template')
      expect(row.templateId).toBe('recTpl1')
      // The organizer's markdown, as HTML, with their merge fields resolved.
      expect(row.payload.html).toContain('<h2>Heads up</h2>')
      expect(row.payload.html).toContain('Ada Okafor sent <strong>Evaluating agents</strong>')
      expect(row.payload.subject).toBe('A submission needs you: SESS-1')
      // The built-in body is gone, not merged with.
      expect(row.payload.html).not.toContain('submitted')
    }
  })

  it('falls back to the built-in body when the stored row is blank', () => {
    const rows = adminAlertRows({
      ...BASE,
      kind: 'update',
      template: stored(TEMPLATE_KEYS.adminUpdate, { bodyMarkdown: '  ' }),
    })

    expect(rows[0].templateSource).toBe('system')
    expect(rows[0].payload.html).toContain('updated a submission you have already seen')
  })

  it('escapes the speaker-controlled values a stored body interpolates', () => {
    const [row] = adminAlertRows({
      ...BASE,
      kind: 'new',
      submissionTitle: '<script>alert(1)</script>',
      template: stored(TEMPLATE_KEYS.adminNew),
    })

    expect(row.payload.html).not.toContain('<script>')
    expect(row.payload.html).toContain('&lt;script&gt;')
  })
})

describe('the new-submission alert row', () => {
  it('keys on the submission with no time component, so a retry writes nothing new', () => {
    // A submission is created once, so `alert-new:<submissionId>` is stable across retries
    // and the DAL's read-then-upsert recognises it. The recipient is appended because an
    // outbox row carries one `toEmail`.
    const rows = adminAlertRows({
      ...BASE,
      kind: 'new',
      recipients: ['a@example.com', 'b@example.com'],
    })

    expect(rows.map((row) => row.idempotencyKey)).toEqual([
      `${idempotencyKeys.adminNew('recSub1')}:a@example.com`,
      `${idempotencyKeys.adminNew('recSub1')}:b@example.com`,
    ])
    // Same submission and same recipients, later clock: the same keys, so nothing sends
    // twice. This is the difference from the UPDATE alert, whose key carries `updatedAt`
    // because a second edit is genuinely a second message.
    const later = adminAlertRows({
      ...BASE,
      kind: 'new',
      recipients: ['a@example.com', 'b@example.com'],
      at: '2026-09-09T00:00:00.000Z',
    })
    expect(later.map((row) => row.idempotencyKey)).toEqual(rows.map((row) => row.idempotencyKey))
  })

  it('is a submission.admin_new row, linked to the event and submission but no speaker', () => {
    const [row] = adminAlertRows({ ...BASE, kind: 'new' })

    expect(row.kind).toBe('submission.admin_new')
    expect(row).toMatchObject({ eventId: 'recEvent1', submissionId: 'recSub1', sendAt: AT })
    // The speaker link on an outbox row is the recipient, and an organizer has none.
    expect(row.speakerId).toBeUndefined()
  })

  it('writes nothing when the form names no recipients', () => {
    expect(adminAlertRows({ ...BASE, kind: 'new', recipients: [] })).toEqual([])
  })

  it('still renders when the submitter has no name on file', () => {
    // Built after the submission landed, so a raised merge-field error here would lose the
    // alert for a submission that exists.
    const [byEmail] = adminAlertRows({
      ...BASE,
      kind: 'new',
      actor: { name: '  ', email: 'ada@example.com' },
    })
    expect(byEmail.payload.html).toContain('ada@example.com')

    const [anonymous] = adminAlertRows({ ...BASE, kind: 'new', actor: { name: '', email: '' } })
    expect(anonymous.payload.html).toContain('A speaker')
  })
})
