// Delivered against outstanding: the arithmetic behind "who still owes a document".

import { describe, expect, it } from 'vitest'

import { deliveryRows, deliveryTotals, withMissingFiles } from '@/features/file-requests/delivery'
import { dedupeRequestAssignments } from '@/features/file-requests/plan'
import type { SpeakerScope } from '@/features/tasks/scope'
import type { FileRequestItem } from '@/services/airtable/reads-requests'

import {
  CO_SPEAKER,
  fileRequest,
  OWNER,
  requestItem,
  STRANGER,
  speaker,
} from './helpers/portal-fakes'

const release = fileRequest({
  id: 'recReqRelease',
  entityType: 'contact',
  title: 'Signed speaker release',
  required: true,
})
const bio = fileRequest({
  id: 'recReqBio',
  entityType: 'contact',
  title: 'Bio as a document',
  required: false,
})
const slides = fileRequest({ id: 'recReqSlides', entityType: 'submission', title: 'Slides' })

const owner: SpeakerScope = {
  speaker: speaker({ id: OWNER, firstName: 'Ada', lastName: 'Okafor' }),
  submissionIds: ['recSub1'],
}
const co: SpeakerScope = {
  speaker: speaker({ id: CO_SPEAKER, firstName: 'Bo', lastName: 'Lin' }),
  submissionIds: ['recSub1'],
}

function item(input: {
  id: string
  request: typeof release
  speakerId?: string
  submissionId?: string
  received?: boolean
}): FileRequestItem {
  return requestItem({
    request: input.request,
    assignment: {
      id: input.id,
      speakerId: input.speakerId ?? OWNER,
      submissionId: input.submissionId,
      status: input.received === true ? 'received' : 'pending',
      receivedAt: input.received === true ? '2026-08-08T10:00:00.000Z' : undefined,
    },
  })
}

const threeRequested: readonly FileRequestItem[] = [
  item({ id: 'recA1', request: release }),
  item({ id: 'recA2', request: bio }),
  item({ id: 'recA3', request: slides, submissionId: 'recSub1' }),
]

describe('deliveryRows', () => {
  it('reads 0/3 before anything arrives and 1/3 after one delivery', () => {
    const before = deliveryRows({ scopes: [owner], items: threeRequested })
    expect(before[0]?.label).toBe('0/3')
    expect(before[0]?.percent).toBe(0)
    expect(before[0]?.outstanding).toBe(3)

    const after = deliveryRows({
      scopes: [owner],
      items: [item({ id: 'recA1', request: release, received: true }), ...threeRequested.slice(1)],
    })
    expect(after[0]?.label).toBe('1/3')
    expect(after[0]?.percent).toBe(33)
    expect(after[0]?.outstanding).toBe(2)
  })

  it('reads 0/0 at zero per cent for a speaker with nothing requested', () => {
    const rows = deliveryRows({ scopes: [owner], items: [] })

    expect(rows[0]?.label).toBe('0/0')
    expect(rows[0]?.percent).toBe(0)
    expect(rows[0]?.missingRequired).toBe(false)
  })

  it('counts a duplicate assignment row as one document', () => {
    const rows = deliveryRows({
      scopes: [owner],
      items: [item({ id: 'recA1', request: release }), item({ id: 'recDupe', request: release })],
    })

    expect(rows[0]?.requested).toBe(1)
    expect(rows[0]?.label).toBe('0/1')
  })

  it('treats a document as delivered when one of two duplicate rows carries the receipt', () => {
    const rows = deliveryRows({
      scopes: [owner],
      items: [
        item({ id: 'recA1', request: release }),
        item({ id: 'recDupe', request: release, received: true }),
      ],
    })

    expect(rows[0]?.label).toBe('1/1')
    expect(rows[0]?.outstandingTitles).toEqual([])
  })

  it('drops an assignment whose speaker is not on the accepted roster', () => {
    const rows = deliveryRows({
      scopes: [owner],
      items: [item({ id: 'recStray', request: release, speakerId: STRANGER })],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.requested).toBe(0)
  })

  it('names the missing titles alphabetically and flags a missing required document', () => {
    const rows = deliveryRows({ scopes: [owner], items: threeRequested })

    expect(rows[0]?.outstandingTitles).toEqual([
      'Bio as a document',
      'Signed speaker release',
      'Slides',
    ])
    expect(rows[0]?.missingRequired).toBe(true)
  })

  it('does not flag a missing optional document as a missing required one', () => {
    const rows = deliveryRows({ scopes: [owner], items: [item({ id: 'recA2', request: bio })] })

    expect(rows[0]?.missingRequired).toBe(false)
  })

  it('keeps one row per speaker in roster order', () => {
    const rows = deliveryRows({
      scopes: [owner, co],
      items: [
        item({ id: 'recA1', request: release, received: true }),
        item({ id: 'recB1', request: release, speakerId: CO_SPEAKER }),
      ],
    })

    expect(rows.map((row) => row.label)).toEqual(['1/1', '0/1'])
  })

  it('gives a speaker with two accepted sessions two documents for one submission request', () => {
    const both: SpeakerScope = {
      speaker: speaker({ id: OWNER }),
      submissionIds: ['recSub1', 'recSub2'],
    }
    const rows = deliveryRows({
      scopes: [both],
      items: [
        item({ id: 'recA3', request: slides, submissionId: 'recSub1', received: true }),
        item({ id: 'recA4', request: slides, submissionId: 'recSub2' }),
      ],
      codeBySubmission: new Map([
        ['recSub1', 'SESS-1'],
        ['recSub2', 'SESS-2'],
      ]),
    })

    expect(rows[0]?.label).toBe('1/2')
    // NAMED, not bare. The count was already right and the sentence looked like a bug: a
    // speaker who had just delivered a deck still read "Slides" outstanding, because the
    // other session owes one too and the title is identical.
    expect(rows[0]?.outstandingTitles).toEqual(['Slides (SESS-2)'])
  })

  it('leaves a per-session title bare when no code is supplied', () => {
    // The map is optional, so a caller that has not loaded submissions still gets a list
    // rather than a row full of `undefined`.
    const both: SpeakerScope = {
      speaker: speaker({ id: OWNER }),
      submissionIds: ['recSub1'],
    }
    const rows = deliveryRows({
      scopes: [both],
      items: [item({ id: 'recA5', request: slides, submissionId: 'recSub1' })],
    })

    expect(rows[0]?.outstandingTitles).toEqual(['Slides'])
  })
})

describe('withMissingFiles and deliveryTotals', () => {
  it('keeps only the speakers who still owe something', () => {
    const rows = deliveryRows({
      scopes: [owner, co],
      items: [
        item({ id: 'recA1', request: release, received: true }),
        item({ id: 'recB1', request: release, speakerId: CO_SPEAKER }),
      ],
    })

    expect(withMissingFiles(rows).map((row) => row.speakerId)).toEqual([CO_SPEAKER])
  })

  it('does not count a speaker with nothing requested as collected', () => {
    const rows = deliveryRows({ scopes: [owner, co], items: threeRequested })

    expect(deliveryTotals(rows)).toEqual({
      speakers: 2,
      requested: 3,
      received: 0,
      complete: 0,
    })
  })
})

describe('duplicate rows, and the three views agreeing, found by Codex review', () => {
  // The identical failure already fixed for task assignments, arriving again because this
  // surface was built from that template. Airtable has no unique constraint, so two rows can
  // describe one document. The bug was that the request card kept whichever row Airtable
  // returned first, this table merged with received-winning, and the speaker's own portal
  // deduplicated not at all: one pending row plus its received duplicate made the card read
  // 0/1, the table read 1/1, and the portal show the document twice.
  const pending = requestItem({ request: release, assignment: { id: 'a1', status: 'pending' } })
  const received = requestItem({
    request: release,
    assignment: { id: 'a2', status: 'received', receivedAt: '2026-08-08T10:00:00.000Z' },
  })

  it('folds a tuple to one entry, with received winning either way round', () => {
    expect(dedupeRequestAssignments([pending, received])).toHaveLength(1)
    expect(dedupeRequestAssignments([pending, received]).at(0)?.assignment.status).toBe('received')
    expect(dedupeRequestAssignments([received, pending]).at(0)?.assignment.status).toBe('received')
  })

  it('keeps a submission-scoped duplicate separate per submission', () => {
    // The tuple includes the submission, so the same request on two accepted sessions is two
    // real documents and must not collapse.
    const one = requestItem({ request: release, assignment: { id: 'b1', submissionId: 'recSub1' } })
    const two = requestItem({ request: release, assignment: { id: 'b2', submissionId: 'recSub2' } })

    expect(dedupeRequestAssignments([one, two])).toHaveLength(2)
  })

  it('makes the delivery table count one document rather than two', () => {
    const rows = deliveryRows({
      scopes: [{ speaker: speaker({ id: OWNER }), submissionIds: [] }],
      items: [pending, received],
    })

    expect(rows.at(0)?.label).toBe('1/1')
  })
})
