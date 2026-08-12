// The portal invitation's row builder. SPK-06.
//
// Four rules, and every one of them is a way this could quietly do the wrong thing rather
// than fail: which body was used, what the key is keyed on, who gets skipped, and that the
// message names no submission.

import { describe, expect, it } from 'vitest'

import { inviteOutboxRows } from '@/features/speakers/invite-outbox'
import type { EmailTemplate } from '@/types/domain'

const base = {
  eventId: 'recEvent',
  eventName: 'AI Engineer Sandbox',
  eventSlug: 'ai-engineer-sandbox',
  invitedAt: '2026-08-09T10:00:00.000Z',
  portalUrl: 'https://bodo.example.com/portal',
}

const ada = {
  speakerId: 'recAda',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
}

describe('inviteOutboxRows', () => {
  it('sends the built-in body when the event has no template', () => {
    const [row] = inviteOutboxRows({ ...base, recipients: [ada] })

    expect(row.templateSource).toBe('system')
    expect(row.templateId).toBeUndefined()
    expect(row.payload.subject).toBe('Your AI Engineer Sandbox speaker portal')
    expect(row.payload.html).toContain('Hi Ada,')
    expect(row.payload.html).toContain(base.portalUrl)
    expect(row.kind).toBe('speaker.invite')
    expect(row.speakerId).toBe('recAda')
    expect(row.sendAt).toBe(base.invitedAt)
  })

  it('never names a submission, because half a roster has none', () => {
    const [row] = inviteOutboxRows({ ...base, recipients: [ada] })

    // The merge context deliberately carries no `submission`, and `renderTemplate` throws on
    // a field the context cannot supply. A body that named one would fail for exactly the
    // people an invitation is most useful to.
    expect(row.payload.html).not.toContain('SESS-')
    expect(row.payload.html).not.toContain('{{')
  })

  it("prefers the organizer's stored template and records where it came from", () => {
    const template: EmailTemplate = {
      id: 'recTemplate',
      eventId: 'recEvent',
      key: 'custom-speaker-invite',
      subject: 'Welcome to {{event.name}}',
      bodyMarkdown: 'Hello {{speaker.firstName}}, go to [the portal]({{portalUrl}}).',
      attachIcs: false,
    }

    const [row] = inviteOutboxRows({ ...base, recipients: [ada], template })

    expect(row.templateSource).toBe('template')
    expect(row.templateId).toBe('recTemplate')
    expect(row.payload.subject).toBe('Welcome to AI Engineer Sandbox')
    expect(row.payload.html).toContain('Hello Ada')
  })

  describe('the idempotency key', () => {
    it("is keyed on 'first' for somebody never invited", () => {
      const [row] = inviteOutboxRows({ ...base, recipients: [ada] })
      expect(row.idempotencyKey).toBe('speaker-invite:recAda:first')
    })

    it('is stable across a retry, because it uses the STORED stamp and not the new one', () => {
      const stored = '2026-07-01T09:00:00.000Z'
      const first = inviteOutboxRows({
        ...base,
        recipients: [{ ...ada, invitedAt: stored }],
      })
      const retry = inviteOutboxRows({
        ...base,
        // A retry takes a fresh clock reading. If the key used THIS instant, the retry would
        // be a different key and would queue a second copy of the same message.
        invitedAt: '2026-08-09T10:00:05.000Z',
        recipients: [{ ...ada, invitedAt: stored }],
      })

      expect(retry[0].idempotencyKey).toBe(first[0].idempotencyKey)
      expect(first[0].idempotencyKey).toBe(`speaker-invite:recAda:${stored}`)
    })

    it('differs once the stamp has moved, so a deliberate re-invite sends', () => {
      const before = inviteOutboxRows({ ...base, recipients: [ada] })
      const after = inviteOutboxRows({
        ...base,
        recipients: [{ ...ada, invitedAt: base.invitedAt }],
      })

      expect(after[0].idempotencyKey).not.toBe(before[0].idempotencyKey)
    })
  })

  describe('recipients', () => {
    it('skips somebody with no address rather than failing the batch', () => {
      const rows = inviteOutboxRows({
        ...base,
        recipients: [
          { speakerId: 'recNone', email: '  ', firstName: 'No', lastName: 'Email' },
          ada,
        ],
      })

      expect(rows).toHaveLength(1)
      expect(rows[0].speakerId).toBe('recAda')
    })

    it('mails one person once when they appear twice under two records', () => {
      const rows = inviteOutboxRows({
        ...base,
        recipients: [ada, { ...ada, speakerId: 'recDuplicate', email: 'ADA@example.com' }],
      })

      expect(rows).toHaveLength(1)
    })

    it('degrades the greeting rather than throwing on a nameless row', () => {
      const [row] = inviteOutboxRows({
        ...base,
        recipients: [
          { speakerId: 'recBare', email: 'bare@example.com', firstName: '', lastName: '' },
        ],
      })

      // A spreadsheet import is a column of addresses. `{{speaker.firstName}}` resolving to
      // nothing would raise MAIL_MERGE_FIELD_UNKNOWN and take the whole invite down.
      expect(row.payload.html).toContain('Hi there,')
    })

    it('falls back to the surname when there is no first name', () => {
      const [row] = inviteOutboxRows({
        ...base,
        recipients: [{ ...ada, firstName: '' }],
      })

      expect(row.payload.html).toContain('Hi Lovelace,')
    })
  })
})
