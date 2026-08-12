import { describe, expect, it } from 'vitest'

import type { MergeContext } from '@/features/comms/templates'
import { idempotencyKeys } from '@/features/comms/triggers'
import { decisionOutboxRows, renderDecision } from '@/features/submissions/decision-outbox'

const BASE = {
  eventId: 'ev1',
  eventName: 'AI Engineer Sandbox',
  eventSlug: 'ai-engineer-sandbox',
  submissionId: 'sub1',
  submissionTitle: 'Evaluating agents',
  submissionCode: 'SESS-1',
  notifiedAt: '2026-08-08T10:00:00.000Z',
  // The epoch being superseded. Never notified, so `'first'`. It is what the idempotency
  // key is built on, deliberately NOT the new `notifiedAt`: see `decisionKey`.
  keyEpoch: 'first',
  portalUrl: 'https://bodo.test/portal',
}

const ADA = {
  speakerId: 'spk1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Okafor',
}
const BRUNO = {
  speakerId: 'spk2',
  email: 'bruno@example.com',
  firstName: 'Bruno',
  lastName: 'Salgado',
}

describe('decisionOutboxRows', () => {
  it('enqueues one row per recipient, queued and unsent', () => {
    const rows = decisionOutboxRows({ ...BASE, decision: 'accept', recipients: [ADA, BRUNO] })
    expect(rows).toHaveLength(2)
    expect(rows[0].toEmail).toBe('ada@example.com')
    // Nothing here sends. The row is the whole output; the comms drain sends it (5.3).
    expect(rows[0].sendAt).toBe(BASE.notifiedAt)
    expect(rows[0].templateSource).toBe('system')
    expect(rows[0].kind).toBe('decision.accepted')
  })

  it('builds its key on the comms trigger key, plus the recipient', () => {
    const [row] = decisionOutboxRows({ ...BASE, decision: 'accept', recipients: [ADA] })
    // The key is the one `features/comms/triggers.ts` owns, so the enqueue and any
    // future retry cannot drift apart. It is per recipient, which is what lets a
    // multi-speaker session reach everybody: the enqueue upserts on this column.
    expect(row.idempotencyKey).toBe(idempotencyKeys.accepted('sub1', BASE.keyEpoch, ADA.speakerId))

    const declined = decisionOutboxRows({ ...BASE, decision: 'decline', recipients: [ADA] })
    expect(declined[0].idempotencyKey).toBe(
      idempotencyKeys.declined('sub1', BASE.keyEpoch, ADA.speakerId),
    )
  })

  it('gives two participants two distinct keys, so neither row overwrites the other', () => {
    const rows = decisionOutboxRows({ ...BASE, decision: 'accept', recipients: [ADA, BRUNO] })
    expect(new Set(rows.map((row) => row.idempotencyKey)).size).toBe(2)
  })

  it('produces identical keys for a repeated Notify at the same instant, so the upsert merges', () => {
    const first = decisionOutboxRows({ ...BASE, decision: 'accept', recipients: [ADA, BRUNO] })
    const second = decisionOutboxRows({ ...BASE, decision: 'accept', recipients: [ADA, BRUNO] })
    expect(first.map((row) => row.idempotencyKey)).toEqual(second.map((row) => row.idempotencyKey))
  })

  it('re-arms after a decision is reversed and remade, because the stored epoch moved', () => {
    // The first press supersedes nothing. The second supersedes the stamp the first one
    // wrote, so its key differs and a genuinely new decision sends. This is the property
    // 5.3 wanted a timestamp in the key for.
    const [first] = decisionOutboxRows({ ...BASE, decision: 'accept', recipients: [ADA] })
    const [later] = decisionOutboxRows({
      ...BASE,
      decision: 'accept',
      recipients: [ADA],
      keyEpoch: '2026-08-08T10:00:00.000Z',
    })
    expect(first.idempotencyKey).not.toBe(later.idempotencyKey)
  })

  it('produces the same key when only the new instant differs, which is what stops a retried Notify duplicating', () => {
    // Mail is enqueued before the status write, so a row whose status write failed still
    // reads as staged. A retry takes a fresh clock reading; if that reading reached the
    // key, the retry would enqueue a second copy of every message and the provider's
    // idempotency key could not collapse them, because they would genuinely differ.
    const [first] = decisionOutboxRows({ ...BASE, decision: 'accept', recipients: [ADA] })
    const [retry] = decisionOutboxRows({
      ...BASE,
      decision: 'accept',
      recipients: [ADA],
      notifiedAt: '2026-08-08T10:05:00.000Z',
    })
    expect(retry.idempotencyKey).toBe(first.idempotencyKey)
    // The new instant still reaches the row, because that is when it will be sent.
    expect(retry.sendAt).toBe('2026-08-08T10:05:00.000Z')
  })

  it('sends one email to a person listed twice on the same submission', () => {
    const rows = decisionOutboxRows({
      ...BASE,
      decision: 'accept',
      recipients: [ADA, { ...ADA, speakerId: 'spk1b', email: 'ADA@example.com' }],
    })
    expect(rows).toHaveLength(1)
  })

  it('skips a participant with no email rather than queueing an unsendable row', () => {
    const rows = decisionOutboxRows({
      ...BASE,
      decision: 'accept',
      recipients: [{ speakerId: 'spk3', email: '   ', firstName: 'No', lastName: 'Body' }],
    })
    expect(rows).toEqual([])
  })

  it('snapshots the rendered body at enqueue time', () => {
    const [row] = decisionOutboxRows({ ...BASE, decision: 'accept', recipients: [ADA] })
    expect(row.payload.subject).toContain('accepted')
    expect(row.payload.html).toContain('Evaluating agents')
    expect(row.payload.attachIcs).toBe(false)
  })

  it('links the row to the event, the submission, and the speaker', () => {
    const [row] = decisionOutboxRows({ ...BASE, decision: 'accept', recipients: [ADA] })
    expect(row).toMatchObject({ eventId: 'ev1', submissionId: 'sub1', speakerId: 'spk1' })
  })
})

describe('renderDecision', () => {
  function context(overrides: Partial<MergeContext> = {}): MergeContext {
    return {
      speaker: { firstName: ADA.firstName, lastName: ADA.lastName, email: ADA.email },
      event: { name: BASE.eventName, slug: BASE.eventSlug },
      submission: { code: BASE.submissionCode, title: BASE.submissionTitle },
      portalUrl: BASE.portalUrl,
      ...overrides,
    }
  }

  it('tells an accepted speaker they are in, and links the portal', () => {
    const { payload } = renderDecision({ decision: 'accept', context: context() })
    expect(payload.html).toContain('has been accepted')
    expect(payload.html).toContain(BASE.portalUrl)
  })

  it('never tells a declined speaker they were accepted', () => {
    const { payload } = renderDecision({ decision: 'decline', context: context() })
    expect(payload.html).not.toContain('accepted')
    expect(payload.subject).toContain('An update')
  })

  it('escapes a title that contains markup, since the body is HTML', () => {
    const { payload } = renderDecision({
      decision: 'accept',
      context: context({
        submission: { code: BASE.submissionCode, title: '<script>alert(1)</script>' },
      }),
    })
    expect(payload.html).not.toContain('<script>')
    expect(payload.html).toContain('&lt;script&gt;')
  })

  it('escapes the recipient name too', () => {
    const { payload } = renderDecision({
      decision: 'accept',
      context: context({
        speaker: { firstName: 'A & B <b>', lastName: ADA.lastName, email: ADA.email },
      }),
    })
    expect(payload.html).toContain('A &amp; B &lt;b&gt;')
  })

  it('leaves the subject unescaped, because a mail header is not markup', () => {
    const { payload } = renderDecision({
      decision: 'accept',
      context: context({ event: { name: 'AI & ML Summit', slug: 'ai-ml' } }),
    })
    expect(payload.subject).toContain('AI & ML Summit')
    expect(payload.subject).not.toContain('&amp;')
  })
})
