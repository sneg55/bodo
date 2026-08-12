// Adversarial folding checks, kept separate from the main ics suite because they
// test the one thing that fails silently: a line folded on a byte boundary inside
// a multi-byte character produces a file that parses and renders mojibake, or a
// line over 75 octets that some clients truncate. Neither shows up as an error.

import { describe, expect, it } from 'vitest'

import { buildInvite } from '@/features/comms/ics'

const base = {
  calendarUid: 'sess-1@bodo.example.com',
  calendarSequence: 0,
  calendarDtstamp: '2026-08-08T12:00:00.000Z',
  startsAt: '2026-10-12T17:00:00.000Z',
  endsAt: '2026-10-12T17:30:00.000Z',
  organizerEmail: 'cfp@bodo.example.com',
  participantEmails: ['a@example.com'],
  title: 'T',
  portalUrl: 'https://bodo.example.com/portal',
}

function octetLines(text: string): { line: string; octets: number }[] {
  return text
    .split('\r\n')
    .filter((l) => l !== '')
    .map((line) => ({ line, octets: new TextEncoder().encode(line).byteLength }))
}

describe('ics folding, adversarial', () => {
  it('never emits a physical line over 75 octets, even with emoji and long CJK', () => {
    const text = buildInvite({
      ...base,
      title: '🚀'.repeat(40) + '評価ハーネスを構築する'.repeat(10),
      portalUrl: `https://bodo.example.com/portal/${'x'.repeat(300)}`,
      room: 'Ω'.repeat(80),
    })
    for (const { line, octets } of octetLines(text)) {
      expect(octets, `line over limit: ${line}`).toBeLessThanOrEqual(75)
    }
  })

  it('unfolds back to the exact original value', () => {
    const title = `🚀 Agents ${'評価'.repeat(30)}`
    const text = buildInvite({ ...base, title })
    // Unfold per RFC 5545: remove CRLF followed by a single space.
    const unfolded = text.replaceAll('\r\n ', '')
    const summary = unfolded.split('\r\n').find((l) => l.startsWith('SUMMARY:'))
    expect(summary).toBe(`SUMMARY:${title}`)
  })

  it('keeps every multi-byte character intact after unfolding', () => {
    const text = buildInvite({ ...base, title: 'é'.repeat(100) })
    const unfolded = text.replaceAll('\r\n ', '')
    expect(unfolded).toContain(`SUMMARY:${'é'.repeat(100)}`)
    expect(unfolded).not.toContain('�')
  })
})
