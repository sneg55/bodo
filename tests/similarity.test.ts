// The properties a similarity score has to hold, not a snapshot of the numbers it currently
// produces. A trigram cosine can be roughly right and still be useless to a reviewer: if it is
// not symmetric the panel disagrees with itself depending on which submission was opened, if
// blank abstracts score 1 the top of every panel is drafts, and if the cap drops rows silently
// then "no duplicates" means nothing.
//
// The fixtures are a set, because the gap between them is what sets DEFAULT_THRESHOLD.
// RESUBMITTED is ORIGINAL retitled with sentences reordered and words changed. SAME_TOPIC is a
// different talk on ORIGINAL's subject, written independently, sharing no sentence. UNRELATED
// is the same length and register on another subject. Measured scores are in the assertions,
// so maths that moves the bands fails here rather than in a reviewer's face.

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_THRESHOLD,
  normalizeText,
  type SimilarityRow,
  similarity,
  similarityPercent,
  similarityRow,
  similarPairs,
  similarTo,
} from '@/features/review/similarity'
import type { SubmissionWithParticipants } from '@/types/domain'

const ORIGINAL_TITLE = 'Scaling Kubernetes to 10,000 Nodes'
const ORIGINAL_BODY =
  'We ran a single Kubernetes cluster past ten thousand nodes and everything that broke ' +
  'along the way was in the control plane, not the workloads. This talk walks through the ' +
  'etcd tuning, the API server flow control settings, and the scheduler changes that got us ' +
  'there, with the dashboards we watched at each step. You will leave knowing which limits ' +
  'you will hit first and what to measure before you hit them.'

const RESUBMITTED_TITLE = 'Ten Thousand Nodes: What Broke in Kubernetes'
const RESUBMITTED_BODY =
  'We ran one Kubernetes cluster past ten thousand nodes, and everything that broke along ' +
  'the way lived in the control plane rather than the workloads. This session walks through ' +
  'the etcd tuning, the API server flow control settings and the scheduler changes that got ' +
  'us there, with the dashboards we watched at every step. You will leave knowing which ' +
  'limits you hit first and what to measure before you hit them.'

const SAME_TOPIC_TITLE = 'Operating Large Kubernetes Clusters Without Losing Sleep'
const SAME_TOPIC_BODY =
  'Running a big cluster is mostly an exercise in patience with etcd. I will cover how our ' +
  'team sized the control plane, why we moved scheduling policy out of the default profile, ' +
  'and the alerts that actually paged us during a bad week. Bring questions about node ' +
  'pools; we will spend the last ten minutes on them.'

const UNRELATED_TITLE = 'Designing Forms People Can Actually Finish'
const UNRELATED_BODY =
  'Most abandoned checkouts are abandoned at a form, and the reasons are rarely visual. ' +
  'We rebuilt our signup around error recovery, keyboard order and honest required-field ' +
  'labelling, then watched completion climb without touching the visual design at all. ' +
  'Expect concrete before-and-after markup, the assistive-technology traces behind each ' +
  'change, and the two patterns we would never ship again.'

function row(id: string, code: string, title: string, text: string): SimilarityRow {
  return { id, code, title, text }
}

const ORIGINAL = row('s1', 'SESS-1', ORIGINAL_TITLE, ORIGINAL_BODY)
const RESUBMITTED = row('s2', 'SESS-142', RESUBMITTED_TITLE, RESUBMITTED_BODY)
const UNRELATED = row('s3', 'SESS-9', UNRELATED_TITLE, UNRELATED_BODY)
const SAME_TOPIC = row('s4', 'SESS-30', SAME_TOPIC_TITLE, SAME_TOPIC_BODY)

const whole = (item: SimilarityRow) => `${item.title} ${item.text}`

describe('similarity', () => {
  it('scores identical text exactly 1 and text with no shared trigrams 0', () => {
    expect(similarity(ORIGINAL_BODY, ORIGINAL_BODY)).toBe(1)
    expect(similarity('a', 'a')).toBe(1)
    expect(similarity('aaaa', 'bbbb')).toBe(0)
    expect(similarity('a', 'b')).toBe(0)
  })

  it('is symmetric to the last bit, not just to a rounding', () => {
    // Exact equality on purpose. `toBeCloseTo` would pass while the sort in `similarPairs`
    // still reordered rows depending on which submission the reviewer had opened.
    expect(similarity(ORIGINAL_BODY, UNRELATED_BODY)).toBe(
      similarity(UNRELATED_BODY, ORIGINAL_BODY),
    )
    expect(similarity(ORIGINAL_BODY, RESUBMITTED_BODY)).toBe(
      similarity(RESUBMITTED_BODY, ORIGINAL_BODY),
    )
  })

  it('scores a retitled, lightly edited resubmission far above the threshold', () => {
    // Measured 0.94.
    const score = similarity(whole(ORIGINAL), whole(RESUBMITTED))

    expect(score).toBeGreaterThan(0.9)
    expect(score).toBeLessThan(1)
  })

  it('scores the same abstract truncated as a near-duplicate', () => {
    // A speaker who resubmitted a shortened version. Measured 0.83: much less than 1, because
    // cosine is over the whole profile, and still nowhere near the unrelated band.
    const short = whole(ORIGINAL).slice(0, 200)
    const score = similarity(whole(ORIGINAL), short)

    expect(score).toBeGreaterThan(DEFAULT_THRESHOLD)
    expect(score).toBeGreaterThan(0.8)
  })

  it('scores two independently written talks on one topic just above the threshold', () => {
    // Measured 0.59. This is the case the threshold is tightest against: it has to clear the
    // unrelated band below without swallowing it.
    const score = similarity(whole(ORIGINAL), whole(SAME_TOPIC))

    expect(score).toBeGreaterThan(DEFAULT_THRESHOLD)
    expect(score).toBeLessThan(0.7)
  })

  it('scores unrelated abstracts of the same length below the threshold', () => {
    // Measured 0.47 and 0.43. Nowhere near 0: two English abstracts share `the`, ` in`, `ing`
    // and every other common fragment, which is why the threshold is not near zero.
    const againstOriginal = similarity(whole(ORIGINAL), whole(UNRELATED))
    const againstSameTopic = similarity(whole(SAME_TOPIC), whole(UNRELATED))

    expect(againstOriginal).toBeGreaterThan(0.4)
    expect(againstOriginal).toBeLessThan(DEFAULT_THRESHOLD)
    expect(againstSameTopic).toBeLessThan(DEFAULT_THRESHOLD)
  })

  it('keeps two unrelated one-liners under the threshold, but only just', () => {
    // Measured 0.54 against a 0.55 threshold, and this is the documented weak spot rather
    // than an accident: in a one-line submission the stock opening is most of the string, so
    // a submission with a title and no abstract is where a false positive appears first. If
    // this ever crosses, DEFAULT_THRESHOLD is wrong, not this test.
    const score = similarity(
      'A short talk about Rust error handling',
      'A short talk about Go module versioning',
    )

    expect(score).toBeLessThan(DEFAULT_THRESHOLD)
    expect(score).toBeGreaterThan(0.5)
  })

  it('ignores case, punctuation and whitespace differences', () => {
    expect(similarity('Scaling K8s: Lessons!', 'scaling   k8s   lessons')).toBe(1)
    expect(similarity('Ten (10) nodes.', '  TEN 10 NODES  ')).toBe(1)
    expect(similarity(ORIGINAL_BODY, ORIGINAL_BODY.toUpperCase().replaceAll(',', ';'))).toBe(1)
  })

  it('returns 0 rather than NaN for empty and one-character text', () => {
    for (const score of [
      similarity('', ''),
      similarity('', ORIGINAL_BODY),
      similarity(ORIGINAL_BODY, ''),
      similarity('   ', '...'),
      similarity('a', ''),
    ]) {
      expect(Number.isNaN(score)).toBe(false)
      expect(score).toBe(0)
    }
  })

  it('keeps every score inside [0, 1]', () => {
    const texts = ['', 'a', 'ab', ORIGINAL_BODY, RESUBMITTED_BODY, UNRELATED_BODY, '12345']
    const scores = texts.flatMap((left) => texts.map((right) => similarity(left, right)))

    expect(scores.every((score) => score >= 0 && score <= 1)).toBe(true)
  })
})

describe('normalizeText', () => {
  it('lowercases, collapses whitespace, drops punctuation and keeps accented letters', () => {
    expect(normalizeText('  Scaling  K8s: 10,000 Nodes!  ')).toBe('scaling k8s 10 000 nodes')
    expect(normalizeText('Décisions Éclairées')).toBe('décisions éclairées')
  })
})

describe('similarityPercent', () => {
  it('rounds to whole percent', () => {
    expect(similarityPercent(0.8449)).toBe(84)
    expect(similarityPercent(0.845)).toBe(85)
    expect(similarityPercent(1)).toBe(100)
    expect(similarityPercent(0)).toBe(0)
  })
})

describe('similarPairs', () => {
  it('reports the duplicate pair and not the unrelated one', () => {
    const result = similarPairs([ORIGINAL, RESUBMITTED, UNRELATED])

    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]?.a.code).toBe('SESS-1')
    expect(result.pairs[0]?.b.code).toBe('SESS-142')
    expect(result.pairs[0]?.score).toBeGreaterThan(0.9)
    expect(result.compared).toBe(3)
    expect(result.dropped).toBe(0)
    expect(result.droppedCodes).toEqual([])
  })

  it('emits each pair once rather than in both directions', () => {
    const copy = row('s5', 'SESS-2', ORIGINAL_TITLE, ORIGINAL_BODY)
    const result = similarPairs([ORIGINAL, copy])

    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]?.score).toBe(1)
  })

  it('includes a pair exactly at the threshold and excludes one just under it', () => {
    // Pinned to the pair's own score rather than to a magic number, so this still tests the
    // `>=` boundary if the trigram maths ever moves.
    const exact = similarity(whole(ORIGINAL), whole(UNRELATED))

    expect(similarPairs([ORIGINAL, UNRELATED], { threshold: exact }).pairs).toHaveLength(1)
    expect(similarPairs([ORIGINAL, UNRELATED], { threshold: exact * 1.0001 }).pairs).toHaveLength(0)
  })

  it('sorts by score descending, then by code', () => {
    const copy = row('s5', 'SESS-2', ORIGINAL_TITLE, ORIGINAL_BODY)
    const alsoCopy = row('s6', 'SESS-3', ORIGINAL_TITLE, ORIGINAL_BODY)
    const result = similarPairs([ORIGINAL, RESUBMITTED, copy, alsoCopy])

    const scores = result.pairs.map((pair) => pair.score)
    expect(scores).toEqual([...scores].sort((left, right) => right - left))
    // The three identical rows all pair at 1, so the tie-break is the only thing ordering
    // them, and it has to be the codes.
    expect(result.pairs.slice(0, 3).map((pair) => `${pair.a.code} ${pair.b.code}`)).toEqual([
      'SESS-1 SESS-2',
      'SESS-1 SESS-3',
      'SESS-2 SESS-3',
    ])
  })

  it('names the rows the cap dropped instead of truncating silently', () => {
    const copy = row('s5', 'SESS-2', ORIGINAL_TITLE, ORIGINAL_BODY)
    const alsoCopy = row('s6', 'SESS-3', ORIGINAL_TITLE, ORIGINAL_BODY)
    const result = similarPairs([ORIGINAL, RESUBMITTED, copy, alsoCopy], { maxRows: 2 })

    expect(result.compared).toBe(2)
    expect(result.dropped).toBe(2)
    expect(result.droppedCodes).toEqual(['SESS-2', 'SESS-3'])
    // Both dropped rows are exact copies of ORIGINAL. Their absence from `pairs` is precisely
    // why `dropped` has to reach the screen: the answer looks complete and is not.
    expect(result.pairs.map((pair) => `${pair.a.code} ${pair.b.code}`)).toEqual(['SESS-1 SESS-142'])
  })

  it('compares nothing on an explicit cap of zero, or on zero and one row', () => {
    const capped = similarPairs([ORIGINAL, RESUBMITTED], { maxRows: 0 })

    expect(capped.pairs).toEqual([])
    expect(capped.compared).toBe(0)
    expect(capped.dropped).toBe(2)
    expect(similarPairs([]).pairs).toEqual([])
    expect(similarPairs([ORIGINAL]).pairs).toEqual([])
    expect(similarPairs([ORIGINAL]).compared).toBe(1)
  })

  it('does not pair two blank submissions', () => {
    const blankA = row('s7', 'SESS-4', '', '')
    const blankB = row('s8', 'SESS-5', '   ', '  ')

    expect(similarPairs([blankA, blankB]).pairs).toEqual([])
  })
})

describe('similarTo', () => {
  it('returns the neighbours of one submission and never the submission itself', () => {
    const result = similarTo(ORIGINAL, [ORIGINAL, RESUBMITTED, UNRELATED])

    expect(result.neighbours).toHaveLength(1)
    expect(result.neighbours[0]?.row.code).toBe('SESS-142')
    expect(similarityPercent(result.neighbours[0]?.score ?? 0)).toBeGreaterThan(90)
    // The target is filtered out before the cap, so it is not counted as compared either.
    expect(result.compared).toBe(2)
  })

  it('reports the rows its cap left unchecked', () => {
    const copy = row('s5', 'SESS-2', ORIGINAL_TITLE, ORIGINAL_BODY)
    const result = similarTo(ORIGINAL, [ORIGINAL, UNRELATED, RESUBMITTED, copy], { maxRows: 1 })

    expect(result.neighbours).toEqual([])
    expect(result.compared).toBe(1)
    expect(result.dropped).toBe(2)
    expect(result.droppedCodes).toEqual(['SESS-142', 'SESS-2'])
  })
})

describe('similarityRow', () => {
  it('reads the abstract body out of the answer the form field points at', () => {
    // The five fields `similarityRow` reads. The cast stands in for the rest of the record:
    // filling in a status and a schedule would say nothing about which answer gets compared.
    const submission = {
      id: 's1',
      formId: 'form1',
      code: 'SESS-1',
      title: ORIGINAL_TITLE,
      answers: { fld_desc: `<p>${ORIGINAL_BODY}</p>` },
    } as unknown as SubmissionWithParticipants

    const built = similarityRow(submission, new Map([['form1', 'fld_desc']]))

    expect(built).toEqual({ id: 's1', code: 'SESS-1', title: ORIGINAL_TITLE, text: ORIGINAL_BODY })
  })
})
