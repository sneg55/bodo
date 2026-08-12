// The reviewer reminder's rows and its message.
//
// The key is the part worth pinning. It decides whether a chair pressing the button
// twice sends two emails, and `enqueueEmails` upserts on it, so a key that varied per
// click would double-mail the whole committee.

import { describe, expect, it } from 'vitest'

import {
  reviewerReminderEmail,
  reviewerReminderKey,
  reviewerReminderRows,
} from '@/features/review/reviewer-reminder'

const recipient = (
  overrides: Partial<Parameters<typeof rowsFor>[0]['recipients'][number]> = {},
) => ({
  reviewerId: 'u1',
  name: 'Ada Byron',
  email: 'ada@example.com',
  assigned: 5,
  reviewed: 2,
  recused: 0,
  percent: 40,
  outstanding: 3,
  ...overrides,
})

function rowsFor(input: Parameters<typeof reviewerReminderRows>[0]) {
  return reviewerReminderRows(input)
}

const BASE = {
  eventId: 'evt1',
  eventName: 'AI Engineer Sandbox',
  roundId: 'r1',
  roundName: 'Screening',
  queueUrl: 'https://example.com/admin/evt1/evaluation?round=r1',
  now: '2026-08-09T11:30:00.000Z',
}

describe('reviewerReminderKey', () => {
  it('is stable across a day, so a second press queues nothing', () => {
    expect(reviewerReminderKey('r1', 'u1', '2026-08-09T09:00:00.000Z')).toBe(
      reviewerReminderKey('r1', 'u1', '2026-08-09T17:45:00.000Z'),
    )
  })

  it('changes the next day, so a chair can chase again', () => {
    expect(reviewerReminderKey('r1', 'u1', '2026-08-09T23:00:00.000Z')).not.toBe(
      reviewerReminderKey('r1', 'u1', '2026-08-10T01:00:00.000Z'),
    )
  })

  it('separates rounds, so a committee behind on both hears about each', () => {
    expect(reviewerReminderKey('r1', 'u1', BASE.now)).not.toBe(
      reviewerReminderKey('r2', 'u1', BASE.now),
    )
  })

  it('separates reviewers, so one row does not stand in for the committee', () => {
    expect(reviewerReminderKey('r1', 'u1', BASE.now)).not.toBe(
      reviewerReminderKey('r1', 'u2', BASE.now),
    )
  })
})

describe('reviewerReminderRows', () => {
  it('builds one system-sourced row per recipient, addressed to them', () => {
    const rows = rowsFor({
      ...BASE,
      recipients: [recipient(), recipient({ reviewerId: 'u2', email: 'chen@example.com' })],
    })

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.toEmail)).toEqual(['ada@example.com', 'chen@example.com'])
    expect(rows[0]).toMatchObject({ eventId: 'evt1', templateSource: 'system' })
    expect(rows[0].payload.attachIcs).toBe(false)
  })

  it('names the outstanding count and the total, not just "you have reviews"', () => {
    // A reviewer who has done four of five reads a bare nudge as a mistake.
    const [row] = rowsFor({ ...BASE, recipients: [recipient({ assigned: 5, outstanding: 1 })] })

    expect(row.payload.subject).toContain('1 submission')
    expect(row.payload.html).toContain('out of 5 assigned')
  })

  it('links to the round the reminder is about', () => {
    const [row] = rowsFor({ ...BASE, recipients: [recipient()] })
    expect(row.payload.html).toContain(BASE.queueUrl)
  })

  it('mentions the close date only when the round has one', () => {
    const [dated] = rowsFor({ ...BASE, recipients: [recipient()], closesAt: 'Aug 14, 2026' })
    const [undated] = rowsFor({ ...BASE, recipients: [recipient()] })

    expect(dated.payload.html).toContain('Aug 14, 2026')
    expect(undated.payload.html).not.toContain('The round closes')
  })
})

describe('reviewerReminderEmail', () => {
  it('says one submission, not "1 submissions"', () => {
    const single = reviewerReminderEmail({
      name: 'Ada',
      eventName: 'E',
      roundName: 'Screening',
      outstanding: 1,
      assigned: 3,
      queueUrl: 'https://example.com',
    })
    const plural = reviewerReminderEmail({
      name: 'Ada',
      eventName: 'E',
      roundName: 'Screening',
      outstanding: 2,
      assigned: 3,
      queueUrl: 'https://example.com',
    })

    expect(single.subject).toContain('1 submission left')
    expect(plural.subject).toContain('2 submissions left')
  })

  it('tells the reviewer that a conflict of interest is a thing they can declare', () => {
    // Otherwise the only way to clear a submission they cannot judge is to score it.
    const mail = reviewerReminderEmail({
      name: 'Ada',
      eventName: 'E',
      roundName: 'Screening',
      outstanding: 1,
      assigned: 1,
      queueUrl: 'https://example.com',
    })

    expect(mail.html).toContain('conflict of interest')
  })
})
