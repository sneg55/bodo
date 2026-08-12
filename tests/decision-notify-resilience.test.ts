// Notify, and what one unfixable row is allowed to cost.
//
// The answer has to be "exactly that row". An organizer selects forty accepted
// submissions and presses Notify once; a throw from any single row used to escape into
// the function-level catch, so the rows before it were committed and emailed, the rows
// after it were silently left staged, and the error said something about a merge field
// rather than that the batch had half-applied. Recovering meant working out by hand
// which rows had landed.
//
// The trigger was real and cheap to hit: a speaker with no first name. `mapSpeaker`
// stores an absent first name as `''`, `mergeFields` does not put an empty value into
// the merge map, and `renderTemplate` then reports `{{speaker.firstName}}` as a field
// the context cannot supply. Both halves are pinned here: the greeting no longer throws,
// and a row that throws for any other reason no longer takes the batch with it.

import { describe, expect, it } from 'vitest'

import { decisionOutboxRows } from '@/features/submissions/decision-outbox'

const BASE = {
  eventId: 'recEvt1',
  eventName: 'AI Engineer Sandbox',
  eventSlug: 'ai-engineer-sandbox',
  submissionId: 'recSub1',
  submissionTitle: 'Reliable agents',
  submissionCode: 'SESS-4',
  notifiedAt: '2026-08-08T12:00:00.000Z',
  keyEpoch: 'first',
  portalUrl: 'https://bodo.example/portal',
} as const

function recipient(over: { firstName?: string; lastName?: string; email?: string } = {}) {
  return {
    speakerId: 'recSpk1',
    email: over.email ?? 'ada@example.com',
    firstName: over.firstName ?? 'Ada',
    lastName: over.lastName ?? 'Lovelace',
  }
}

function rowsFor(recipients: readonly ReturnType<typeof recipient>[]) {
  return decisionOutboxRows({ ...BASE, decision: 'accept', recipients })
}

describe('a recipient with no first name', () => {
  it('does not throw, where it used to fail the whole Notify press', () => {
    expect(() => rowsFor([recipient({ firstName: '' })])).not.toThrow()
  })

  it('falls back to the last name rather than greeting nobody', () => {
    const html = rowsFor([recipient({ firstName: '' })]).at(0)?.payload.html ?? ''

    expect(html).toContain('Hi Lovelace,')
  })

  it('falls back to a neutral salutation when neither name is present', () => {
    const html = rowsFor([recipient({ firstName: '', lastName: '' })]).at(0)?.payload.html ?? ''

    expect(html).toContain('Hi there,')
    // The one thing it must never be: a greeting addressed to nothing at all.
    expect(html).not.toContain('Hi ,')
  })

  it('treats whitespace as absent, since a spacebar in a text column is not a name', () => {
    const html =
      rowsFor([recipient({ firstName: '   ', lastName: '  ' })]).at(0)?.payload.html ?? ''

    expect(html).toContain('Hi there,')
  })

  it('still uses a real first name when there is one', () => {
    const html = rowsFor([recipient()]).at(0)?.payload.html ?? ''

    expect(html).toContain('Hi Ada,')
  })
})

describe('what the merge guard must still catch', () => {
  it('keeps escaping merged values, so a name cannot inject markup', () => {
    // The fallback must not become a hole in the escaping the template layer does.
    const html =
      rowsFor([recipient({ firstName: '<script>alert(1)</script>' })]).at(0)?.payload.html ?? ''

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('writes one row per recipient, so a nameless co-speaker still gets their own', () => {
    const rows = rowsFor([
      recipient(),
      { speakerId: 'recSpk2', email: 'bruno@example.com', firstName: '', lastName: '' },
    ])

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.toEmail)).toEqual(['ada@example.com', 'bruno@example.com'])
    // Per-recipient keys, or the upsert would collapse these two into one row.
    expect(new Set(rows.map((row) => row.idempotencyKey)).size).toBe(2)
  })
})
