// The admin alert a speaker's edit owes, and the key that stops it arriving twice.
//
// BUILD_SPEC 5.3: an edit AFTER submission tells `Forms.adminAlertOnUpdate`, keyed on
// `alert-update:<submissionId>:<updatedAt>`. The interesting assertions are all about the
// key, because the enqueue upserts on it: a key that varies between two saves of the same
// edit is not an idempotency key, it is a duplicate generator.

import { describe, expect, it } from 'vitest'

import { idempotencyKeys } from '@/features/comms/triggers'
import { adminUpdateOutboxRows, type UpdateAlertInput } from '@/features/portal/update-alert'

const UPDATED_AT = '2026-08-08T12:00:00.000Z'

const BASE: UpdateAlertInput = {
  eventId: 'recEvent1',
  eventName: 'AI Engineer Sandbox',
  eventSlug: 'ai-engineer-sandbox',
  submissionId: 'recSub1',
  submissionTitle: 'Evaluating agents',
  submissionCode: 'SESS-1',
  recipients: ['organizer@example.com'],
  editor: { name: 'Ada Okafor', email: 'ada@example.com' },
  updatedAt: UPDATED_AT,
  linkUrl: 'https://bodo.test/admin/recEvent1/abstracts',
}

describe('adminUpdateOutboxRows', () => {
  it('enqueues exactly one row for one configured recipient', () => {
    const rows = adminUpdateOutboxRows(BASE)
    expect(rows).toHaveLength(1)
    expect(rows[0].toEmail).toBe('organizer@example.com')
    expect(rows[0].kind).toBe('submission.admin_update')
    // Nothing here sends. The row is the whole output, and the drain sends it (5.3).
    expect(rows[0].sendAt).toBe(UPDATED_AT)
    expect(rows[0].templateSource).toBe('system')
  })

  it('writes nothing at all when the form configures no recipients', () => {
    // The gate in 5.3 is "recipient list non-empty". An unconfigured form is not an error.
    expect(adminUpdateOutboxRows({ ...BASE, recipients: [] })).toEqual([])
  })

  it('builds its key on the 5.3 trigger key, so the enqueue and any retry cannot drift', () => {
    const [row] = adminUpdateOutboxRows(BASE)
    expect(row.idempotencyKey.startsWith(idempotencyKeys.adminUpdate('recSub1', UPDATED_AT))).toBe(
      true,
    )
  })

  it('collapses two saves at the same updatedAt to one row', () => {
    const first = adminUpdateOutboxRows(BASE)
    const second = adminUpdateOutboxRows(BASE)
    // Identical keys, so the upsert merges them and the organizer is told once.
    expect(first.map((row) => row.idempotencyKey)).toEqual(second.map((row) => row.idempotencyKey))
    expect(new Set([...first, ...second].map((row) => row.idempotencyKey)).size).toBe(1)
  })

  it('re-arms for a later edit, because updatedAt moved', () => {
    const [later] = adminUpdateOutboxRows({ ...BASE, updatedAt: '2026-08-09T12:00:00.000Z' })
    expect(later.idempotencyKey).not.toBe(adminUpdateOutboxRows(BASE)[0].idempotencyKey)
  })

  it('gives two organizers two distinct keys, so neither row overwrites the other', () => {
    const rows = adminUpdateOutboxRows({
      ...BASE,
      recipients: ['first@example.com', 'second@example.com'],
    })
    expect(rows.map((row) => row.toEmail)).toEqual(['first@example.com', 'second@example.com'])
    expect(new Set(rows.map((row) => row.idempotencyKey)).size).toBe(2)
  })

  it('tells an organizer listed twice only once', () => {
    const rows = adminUpdateOutboxRows({
      ...BASE,
      recipients: ['organizer@example.com', ' Organizer@Example.com '],
    })
    expect(rows).toHaveLength(1)
  })

  it('names the editor, the submission, and where to go', () => {
    const [row] = adminUpdateOutboxRows(BASE)
    expect(row.payload.subject).toBe('SESS-1 was updated by the speaker')
    expect(row.payload.html).toContain('Ada Okafor')
    expect(row.payload.html).toContain('Evaluating agents')
    expect(row.payload.html).toContain(BASE.linkUrl)
    expect(row.payload.attachIcs).toBe(false)
  })

  it('escapes a title that contains markup, since the body is HTML', () => {
    const [row] = adminUpdateOutboxRows({ ...BASE, submissionTitle: '<script>alert(1)</script>' })
    expect(row.payload.html).not.toContain('<script>')
    expect(row.payload.html).toContain('&lt;script&gt;')
  })

  it('still renders when the editor has no name on file', () => {
    // The row is built after the submission has been written, so a raised merge-field
    // error here would turn a saved edit into a failure the organizer never hears about.
    const [byEmail] = adminUpdateOutboxRows({
      ...BASE,
      editor: { name: '  ', email: 'ada@example.com' },
    })
    expect(byEmail.payload.html).toContain('ada@example.com')

    const [anonymous] = adminUpdateOutboxRows({ ...BASE, editor: { name: '', email: '' } })
    expect(anonymous.payload.html).toContain('A speaker')
  })

  it('falls back to the code when the record carries a blank title', () => {
    const [row] = adminUpdateOutboxRows({ ...BASE, submissionTitle: '   ' })
    expect(row.payload.html).toContain('SESS-1')
  })

  it('links the row to the event and the submission, and to no speaker', () => {
    const [row] = adminUpdateOutboxRows(BASE)
    expect(row).toMatchObject({ eventId: 'recEvent1', submissionId: 'recSub1' })
    // The speaker link on an outbox row is the recipient, and an organizer has none.
    expect(row.speakerId).toBeUndefined()
  })
})
