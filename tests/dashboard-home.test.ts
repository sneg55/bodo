// The event home's arithmetic. Every case here is something that reads as a bug on the
// first screen an organizer sees, which is why the logic is pure and not inline in a page.
//
// What is deliberately NOT covered, because it is deliberately not built: the pacing chart,
// the donuts, the stacked bars and the custom-dashboard widgets. SPEC.md line 44 defers
// dashboard analytics and charts, and docs/parity/dashboard.md marks the surface P2.

import { describe, expect, it } from 'vitest'
import type { SubmissionStatus } from '@/constants/status'
import {
  advisories,
  formProgress,
  recentSubmissions,
  STATUS_TILE_ORDER,
  statusTiles,
} from '@/features/dashboard/home-view'
import type { Form } from '@/types/forms'

const href = (path: string) => `/admin/recEvent1${path}`

type Row = {
  status: SubmissionStatus
  startsAt?: string
  scheduleStatus: 'unscheduled' | 'scheduled' | 'published'
  formId?: string
  submittedAt?: string
}

const row = (over: Partial<Row> = {}): Row => ({
  status: 'pending',
  scheduleStatus: 'unscheduled',
  ...over,
})

describe('statusTiles', () => {
  it('counts each status and shows a zero rather than omitting the tile', () => {
    const tiles = statusTiles([row({ status: 'accepted' }), row(), row()])
    const byStatus = new Map(tiles.map((tile) => [tile.status, tile.count]))

    expect(byStatus.get('accepted')).toBe(1)
    expect(byStatus.get('pending')).toBe(2)
    expect(byStatus.get('declined')).toBe(0)
  })

  it('keeps the captured order and puts the uncaptured statuses after it', () => {
    const order = statusTiles([]).map((tile) => tile.status)

    expect(order.slice(0, STATUS_TILE_ORDER.length)).toEqual(STATUS_TILE_ORDER)
    // The queue states are not in ref 34, and dropping them would let a staged decision go
    // uncounted on the one screen that claims to total the submissions.
    expect(order).toContain('accept_queue')
    expect(order).toContain('decline_queue')
  })

  it('totals to the number of submissions, so no row is counted twice or lost', () => {
    const rows = [row({ status: 'accepted' }), row({ status: 'accept_queue' }), row()]
    const total = statusTiles(rows).reduce((sum, tile) => sum + tile.count, 0)

    expect(total).toBe(rows.length)
  })
})

describe('advisories', () => {
  it('reports an accepted session with no time slot, linking to the agenda', () => {
    const found = advisories({
      submissions: [
        row({ status: 'accepted' }),
        row({ status: 'accepted', startsAt: '2026-10-12T17:00:00.000Z' }),
      ],
      eventHref: href,
    })

    expect(found.map((entry) => entry.id)).toEqual(['unslotted'])
    expect(found[0]?.text).toBe('1 accepted session still needs a time slot on the agenda.')
    expect(found[0]?.href).toBe('/admin/recEvent1/agenda')
  })

  it('agrees with itself on plurals', () => {
    const found = advisories({
      submissions: [row({ status: 'accepted' }), row({ status: 'accepted' })],
      eventHref: href,
    })

    expect(found[0]?.text).toBe('2 accepted sessions still need a time slot on the agenda.')
  })

  it('reports staged decisions, which are the ones an organizer forgets to send', () => {
    const found = advisories({
      submissions: [row({ status: 'accept_queue' }), row({ status: 'decline_queue' })],
      eventHref: href,
    })

    expect(found.map((entry) => entry.id)).toContain('staged')
    expect(found.find((entry) => entry.id === 'staged')?.text).toBe(
      '2 decisions are staged and not yet sent.',
    )
  })

  it('reports a scheduled session that is not on the public agenda', () => {
    const found = advisories({
      submissions: [row({ status: 'accepted', startsAt: 'x', scheduleStatus: 'scheduled' })],
      eventHref: href,
    })

    expect(found.map((entry) => entry.id)).toContain('unpublished')
  })

  it('returns nothing when there is nothing to do', () => {
    // The point of the strip. An advisory reading "0 sessions need a time slot" is noise
    // dressed as a task, so a quiet event shows an empty strip and not a row of zeroes.
    expect(
      advisories({
        submissions: [
          row({
            status: 'accepted',
            startsAt: '2026-10-12T17:00:00.000Z',
            scheduleStatus: 'published',
          }),
        ],
        eventHref: href,
      }),
    ).toEqual([])
  })
})

describe('formProgress', () => {
  const form = (over: Partial<Form> & { id: string }): Form =>
    ({
      name: `Form ${over.id}`,
      status: 'published',
      kind: 'cfp',
      publicId: `pub-${over.id}`,
      eventId: 'recEvent1',
      fields: [],
      participantFields: [],
      ...over,
    }) as Form

  it('counts submissions per form and totals only what came through a form', () => {
    const result = formProgress({
      forms: [form({ id: 'f1' }), form({ id: 'f2' })],
      submissions: [
        row({ formId: 'f1' }),
        row({ formId: 'f1' }),
        row({ formId: 'f2' }),
        // Entered by hand in the admin, so it belongs to no form. Counting it in the
        // aggregate bar would make the bar disagree with the sum of the cards.
        row({ formId: undefined }),
      ],
      now: new Date('2026-08-08T19:00:00.000Z'),
    })

    expect(result.forms.map((entry) => entry.submitted)).toEqual([2, 1])
    expect(result.submitted).toBe(3)
  })

  it('derives the badge through formPublicState rather than the stored status', () => {
    const result = formProgress({
      forms: [
        form({ id: 'open' }),
        form({ id: 'shut', closeDate: '2026-01-01T00:00:00.000Z' }),
        form({ id: 'unpublished', status: 'draft' }),
      ],
      submissions: [],
      now: new Date('2026-08-08T19:00:00.000Z'),
    })

    expect(result.forms.map((entry) => entry.state)).toEqual(['open', 'closed', 'draft'])
  })

  it('counts how many forms are receiving, which is the only real ratio available', () => {
    // The aggregate bar's numerator. A bar over a submission COUNT would need a
    // denominator nobody has, because no form carries a quota, so the bar shows forms that
    // have received something and the caption shows the count. Two different facts.
    const result = formProgress({
      forms: [form({ id: 'busy' }), form({ id: 'quiet' }), form({ id: 'alsoQuiet' })],
      submissions: [row({ formId: 'busy' }), row({ formId: 'busy' })],
      now: new Date('2026-08-08T19:00:00.000Z'),
    })

    expect(result.receiving).toBe(1)
    expect(result.submitted).toBe(2)
  })

  it('words a close date in the future and in the past', () => {
    // Ref 35 captures the future case only ("Closes in a month"). The past case is authored
    // and it is needed: a form keeps its close date after it passes, and a card reading
    // "Closes in 3 days ago" would be worse than saying nothing.
    const result = formProgress({
      forms: [
        form({ id: 'soon', closeDate: '2026-08-11T00:00:00.000Z' }),
        form({ id: 'later', closeDate: '2026-09-15T00:00:00.000Z' }),
        form({ id: 'past', closeDate: '2026-08-05T00:00:00.000Z' }),
        form({ id: 'never' }),
      ],
      submissions: [],
      now: new Date('2026-08-08T00:00:00.000Z'),
    })

    const labels = new Map(result.forms.map((entry) => [entry.id, entry.closesLabel]))
    expect(labels.get('soon')).toBe('Closes in 3 days')
    expect(labels.get('later')).toBe('Closes next month')
    expect(labels.get('past')).toBe('Closed 3 days ago')
    // No close date is not the same as closed, so the line is absent rather than guessed.
    expect(labels.get('never')).toBeUndefined()
  })

  it('does not say Closes today about a deadline that has passed', () => {
    // `formPublicState` flips to closed the instant the deadline passes, but the wording came
    // from the ROUNDED day count, so a deadline eight hours gone rounded to 0 and rendered
    // "Closes today" beside a Closed badge. The tense now comes from the comparison and only
    // the number comes from the rounding. Found by Codex review.
    const result = formProgress({
      forms: [
        form({ id: 'justPassed', closeDate: '2026-08-08T02:00:00.000Z' }),
        form({ id: 'laterToday', closeDate: '2026-08-08T18:00:00.000Z' }),
      ],
      submissions: [],
      now: new Date('2026-08-08T10:00:00.000Z'),
    })

    const labels = new Map(result.forms.map((entry) => [entry.id, entry.closesLabel]))
    expect(labels.get('justPassed')).toBe('Closed today')
    expect(labels.get('laterToday')).toBe('Closes today')
    // And the badge agrees, which is the disagreement that made it a bug.
    expect(result.forms.find((entry) => entry.id === 'justPassed')?.state).toBe('closed')
  })

  it('does not count a draft as a submission', () => {
    // A draft is not a submission. Counting one said "1 submitted" with a full progress bar
    // for a form nobody had submitted to, and `list-view.ts` already drew this line, so the
    // two disagreed. Found by Codex review.
    const result = formProgress({
      forms: [form({ id: 'f1' })],
      submissions: [row({ formId: 'f1', status: 'draft' }), row({ formId: 'f1' })],
      now: new Date('2026-08-08T19:00:00.000Z'),
    })

    expect(result.forms.at(0)?.submitted).toBe(1)
    expect(result.submitted).toBe(1)
  })

  it('leaves portal forms off the submission-forms row entirely', () => {
    // `Form.kind` is cfp or task and `listForms` returns both, so a PORTAL form appeared here
    // as a zero-submission card, inflated the aggregate denominator, and would have offered a
    // /submit/... link that is not a route for it. Found by Codex review, just as portal forms
    // were being built.
    const result = formProgress({
      forms: [form({ id: 'cfp1' }), form({ id: 'portal1', kind: 'task' })],
      submissions: [row({ formId: 'cfp1' })],
      now: new Date('2026-08-08T19:00:00.000Z'),
    })

    expect(result.forms.map((entry) => entry.id)).toEqual(['cfp1'])
    expect(result.receiving).toBe(1)
  })

  it('reports a form with no submissions as zero, not as absent', () => {
    const result = formProgress({
      forms: [form({ id: 'quiet' })],
      submissions: [],
      now: new Date('2026-08-08T19:00:00.000Z'),
    })

    expect(result.forms).toHaveLength(1)
    expect(result.forms[0]?.submitted).toBe(0)
    expect(result.submitted).toBe(0)
  })
})

describe('recentSubmissions', () => {
  it('puts the newest first and caps the list', () => {
    const rows = [
      row({ submittedAt: '2026-08-01T00:00:00.000Z' }),
      row({ submittedAt: '2026-08-07T00:00:00.000Z' }),
      row({ submittedAt: '2026-08-04T00:00:00.000Z' }),
    ]

    expect(recentSubmissions(rows, 2).map((entry) => entry.submittedAt)).toEqual([
      '2026-08-07T00:00:00.000Z',
      '2026-08-04T00:00:00.000Z',
    ])
  })

  it('sorts a submission with no timestamp last instead of dropping it', () => {
    const rows = [row({ submittedAt: undefined }), row({ submittedAt: '2026-08-01T00:00:00.000Z' })]

    expect(recentSubmissions(rows, 5).map((entry) => entry.submittedAt)).toEqual([
      '2026-08-01T00:00:00.000Z',
      undefined,
    ])
  })

  it('does not mutate the input', () => {
    const rows = [
      row({ submittedAt: '2026-08-01T00:00:00.000Z' }),
      row({ submittedAt: '2026-08-07T00:00:00.000Z' }),
    ]
    recentSubmissions(rows, 2)

    expect(rows[0]?.submittedAt).toBe('2026-08-01T00:00:00.000Z')
  })
})
