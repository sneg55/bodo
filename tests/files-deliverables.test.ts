// One row per (speaker, requested document): the arithmetic behind the Delivery status table.
// CNT-07.
//
// The criterion is specific about the shape, so that is what most of this file asserts: a PAIR
// with its own status and its own due date, not a per-speaker aggregate. The rest covers the
// cases that were wrong answers waiting to happen, the same ones the aggregate's tests pin.
//
// The Columns/Sort/Filter panes over these rows are asserted next door, in
// files-deliverable-query.test.ts.

import { describe, expect, it } from 'vitest'

import { deliverableRows, deliverableTabs } from '@/features/files/deliverables'
import type { SpeakerScope } from '@/features/tasks/scope'
import type { FileRequestItem } from '@/services/airtable/reads-requests'

import {
  BIO,
  CO_SCOPE,
  CODES,
  item,
  NOW,
  OWNER_SCOPE,
  RELEASE,
  SLIDES,
  TZ,
} from './helpers/deliverable-fakes'
import { CO_SPEAKER, OWNER, STRANGER } from './helpers/portal-fakes'

function rowsFor(
  items: readonly FileRequestItem[],
  scopes: readonly SpeakerScope[] = [OWNER_SCOPE, CO_SCOPE],
) {
  return deliverableRows({ scopes, items, timeZone: TZ, codeBySubmission: CODES, now: NOW })
}

describe('deliverableRows', () => {
  it('is one row per speaker per requested document, each with its own due date', () => {
    const rows = rowsFor([
      item({ id: 'a1', request: RELEASE }),
      item({ id: 'a2', request: BIO }),
      item({ id: 'a3', request: RELEASE, speakerId: CO_SPEAKER, received: true }),
    ])

    expect(rows).toHaveLength(3)
    const adaRelease = rows.find(
      (row) => row.speakerId === OWNER && row.fileRequestId === RELEASE.id,
    )
    expect(adaRelease?.dueDate).toBe('Aug 1, 2026')
    expect(adaRelease?.required).toBe(true)
    // The other row is the same person on a different document, with no deadline at all.
    const adaBio = rows.find((row) => row.speakerId === OWNER && row.fileRequestId === BIO.id)
    expect(adaBio?.dueDate).toBeUndefined()
    expect(adaBio?.state).toBe('outstanding')
  })

  it('marks an outstanding document past its deadline overdue, and a delivered one never', () => {
    const rows = rowsFor([
      item({ id: 'a1', request: RELEASE }),
      item({ id: 'a2', request: SLIDES, submissionId: 'recSub1' }),
      item({
        id: 'a3',
        request: RELEASE,
        speakerId: CO_SPEAKER,
        received: true,
        receivedAt: '2026-08-09T10:00:00.000Z',
      }),
    ])

    expect(rows.find((row) => row.id.startsWith(`${OWNER}:${RELEASE.id}`))?.state).toBe('overdue')
    expect(rows.find((row) => row.id.startsWith(`${OWNER}:${SLIDES.id}`))?.state).toBe(
      'outstanding',
    )
    const delivered = rows.find((row) => row.speakerId === CO_SPEAKER)
    expect(delivered?.state).toBe('received')
    expect(delivered?.receivedDate).toBe('Aug 9, 2026')
  })

  it('names the session of a per-session request, so two decks are not one repeated title', () => {
    const rows = rowsFor([
      item({ id: 'a1', request: SLIDES, submissionId: 'recSub1' }),
      item({ id: 'a2', request: SLIDES, submissionId: 'recSub2' }),
    ])

    expect(rows.map((row) => row.sessionCode)).toEqual(['SESS-1', 'SESS-2'])
    expect(new Set(rows.map((row) => row.id)).size).toBe(2)
  })

  it('folds a duplicate row for the same tuple into one document, received winning', () => {
    // Airtable has no unique constraint, so a row added in the base by hand would otherwise
    // appear twice and inflate every count on the surface.
    const rows = rowsFor([
      item({ id: 'a1', request: RELEASE }),
      item({ id: 'a2', request: RELEASE, received: true }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]?.state).toBe('received')
  })

  it('drops an assignment pointing outside the accepted roster', () => {
    const rows = rowsFor([
      item({ id: 'a1', request: RELEASE }),
      item({ id: 'a2', request: RELEASE, speakerId: STRANGER }),
    ])

    expect(rows.map((row) => row.speakerId)).toEqual([OWNER])
  })

  it("carries the person's whole delivered fraction on every one of their rows", () => {
    const rows = rowsFor([
      item({ id: 'a1', request: RELEASE, received: true }),
      item({ id: 'a2', request: BIO }),
      item({ id: 'a3', request: SLIDES, submissionId: 'recSub1' }),
    ])

    expect(rows.every((row) => row.speakerLabel === '1/3')).toBe(true)
    expect(rows[0]?.speakerPercent).toBe(33)
  })

  it('opens on the soonest deadline with the undated last', () => {
    const rows = rowsFor([
      item({ id: 'a1', request: BIO }),
      item({ id: 'a2', request: SLIDES, submissionId: 'recSub1' }),
      item({ id: 'a3', request: RELEASE }),
    ])

    expect(rows.map((row) => row.title)).toEqual([
      'Signed speaker release',
      'Slides',
      'Bio as a document',
    ])
  })
})

describe('deliverableTabs', () => {
  it('counts overdue as a subset of outstanding', () => {
    const rows = rowsFor([
      item({ id: 'a1', request: RELEASE }),
      item({ id: 'a2', request: BIO }),
      item({ id: 'a3', request: RELEASE, speakerId: CO_SPEAKER, received: true }),
    ])

    expect(deliverableTabs(rows)).toEqual([
      { id: 'all', label: 'All deliverables', count: 3 },
      { id: 'outstanding', label: 'Outstanding', count: 2 },
      { id: 'overdue', label: 'Overdue', count: 1 },
      { id: 'received', label: 'Delivered', count: 1 },
    ])
  })
})
