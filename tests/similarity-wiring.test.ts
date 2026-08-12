// What the join between the scoring and the read has to hold. `similarity.ts` is covered by
// tests/similarity.test.ts and none of that is repeated here: these are the three ways the
// wiring can be wrong while every score is right, and each of them fails silently on screen.
//
//   - Read the body through the wrong key and every row compares as a bare title, so a panel
//     that reports nothing is indistinguishable from a round with no duplicates.
//   - Let the target through the sweep and it matches itself at 100%, so the top row of every
//     panel is the submission the reader already has open.
//   - Order the input wrongly and a capped event compares the earliest submissions to each
//     other, which is the half of the list least likely to contain a resubmission.

import { describe, expect, it } from 'vitest'

import { similarToSubmission } from '@/features/review/similarity-read'
import type { SubmissionWithParticipants } from '@/types/domain'
import type { Form } from '@/types/forms'

const BODY =
  'We ran a single Kubernetes cluster past ten thousand nodes and everything that broke ' +
  'along the way was in the control plane, not the workloads. This talk walks through the ' +
  'etcd tuning, the API server flow control settings, and the scheduler changes that got us ' +
  'there, with the dashboards we watched at each step.'

const EDITED_BODY =
  'We ran one Kubernetes cluster past ten thousand nodes, and everything that broke along ' +
  'the way lived in the control plane rather than the workloads. This session walks through ' +
  'the etcd tuning, the API server flow control settings and the scheduler changes that got ' +
  'us there, with the dashboards we watched at every step.'

const OTHER_BODY =
  'Most abandoned checkouts are abandoned at a form, and the reasons are rarely visual. We ' +
  'rebuilt our signup around error recovery, keyboard order and honest required-field ' +
  'labelling, then watched completion climb without touching the visual design at all.'

/**
 * The five fields the sweep reads, plus `submittedAt` because it is the sort key. The cast
 * stands in for the rest of the record: a status and a schedule would say nothing about which
 * answer gets compared, and spelling out a whole `SubmissionWithParticipants` per fixture would
 * bury the one field each case is about.
 */
function submission(input: {
  id: string
  code: string
  title: string
  formId?: string
  answers: Record<string, unknown>
  submittedAt?: string
}): SubmissionWithParticipants {
  return input as unknown as SubmissionWithParticipants
}

/** A CFP form whose description field carries the id the answers are keyed by. */
function form(id: string, descriptionFieldId: string): Form {
  return {
    id,
    fields: [{ id: descriptionFieldId, registryKey: 'description' }],
  } as unknown as Form
}

const FORMS = [form('form_a', 'fld_a_desc'), form('form_b', 'fld_b_desc')]

const TARGET = submission({
  id: 's1',
  code: 'SESS-1',
  title: 'Scaling Kubernetes to 10,000 Nodes',
  formId: 'form_a',
  answers: { fld_a_desc: `<p>${BODY}</p>` },
  submittedAt: '2026-03-01T10:00:00.000Z',
})

describe('similarToSubmission', () => {
  it('resolves each body through its own form, so submissions from two forms compare', () => {
    // The point of the case: the near-duplicate arrived through form_b, so its body sits under
    // a different answer key. A single hardcoded key would score this pair on titles alone.
    const resubmission = submission({
      id: 's2',
      code: 'SESS-142',
      title: 'Ten Thousand Nodes: What Broke in Kubernetes',
      formId: 'form_b',
      answers: { fld_b_desc: `<p>${EDITED_BODY}</p>` },
      submittedAt: '2026-04-02T10:00:00.000Z',
    })
    const unrelated = submission({
      id: 's3',
      code: 'SESS-9',
      title: 'Designing Forms People Can Actually Finish',
      formId: 'form_a',
      answers: { fld_a_desc: `<p>${OTHER_BODY}</p>` },
      submittedAt: '2026-04-03T10:00:00.000Z',
    })

    const result = similarToSubmission({
      target: TARGET,
      submissions: [TARGET, resubmission, unrelated],
      forms: FORMS,
    })

    expect(result.neighbours.map((neighbour) => neighbour.row.code)).toEqual(['SESS-142'])
    expect(result.neighbours[0]?.score).toBeGreaterThan(0.85)
  })

  it('never scores the target against itself, though the list it is handed contains it', () => {
    const result = similarToSubmission({
      target: TARGET,
      submissions: [TARGET, submission({ ...bare('s2', 'SESS-2'), submittedAt: '2026-03-02' })],
      forms: FORMS,
    })

    // Two rows in, one of them the target: it is removed by id before the cap, so exactly one
    // row was compared and a 100% self-match cannot appear at the top of the panel.
    expect(result.compared).toBe(1)
    expect(result.dropped).toBe(0)
    expect(result.neighbours.every((neighbour) => neighbour.row.id !== 's1')).toBe(true)
  })

  it('compares the newest submissions first, because a resubmission arrives late', () => {
    const oldest = submission({ ...bare('s2', 'SESS-2'), submittedAt: '2026-01-01' })
    const newest = submission({ ...bare('s3', 'SESS-3'), submittedAt: '2026-05-01' })
    // Never posted through a form, so it has no submission stamp and sorts last rather than
    // first: an empty string must not read as the newest possible date.
    const manual = submission(bare('s4', 'SESS-4'))

    const result = similarToSubmission({
      target: TARGET,
      submissions: [oldest, manual, TARGET, newest],
      forms: FORMS,
      options: { maxRows: 1 },
    })

    expect(result.compared).toBe(1)
    expect(result.droppedCodes).toEqual(['SESS-2', 'SESS-4'])
  })
})

/** A submission with a body of its own, for the cases that only care about ordering. */
function bare(id: string, code: string) {
  return {
    id,
    code,
    title: `Session ${code}`,
    formId: 'form_a',
    answers: { fld_a_desc: `<p>${OTHER_BODY}</p>` },
  }
}
