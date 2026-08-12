// The Delivery status table's Columns, Sort and Filter panes, and the reminder's recipient set.
// CNT-07 and CNT-08.
//
// The defect these pin: the picker over this table offered the 22 SESSION fields (Track, Room,
// Abstract) because `DataTable`'s catalog prop defaults to the submission registry, and
// applying a selection committed nothing because the surface passed a no-op. So the assertions
// here are that every key the drawer offers is answerable, and that a query over those keys
// changes the rows.

import { describe, expect, it } from 'vitest'

import {
  DELIVERABLE_ACCESSORS,
  DELIVERABLE_CATALOG,
  DELIVERABLE_FIELDS,
  queryDeliverables,
} from '@/features/files/deliverable-query'
import { type DeliverableRow, deliverableRows } from '@/features/files/deliverables'
import {
  outstandingDeliverableRows,
  selectedOutstandingFiles,
} from '@/features/files/outstanding-deliverables'
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
import { CO_SPEAKER, OWNER, STRANGER, speaker } from './helpers/portal-fakes'

function rowsFor(
  items: readonly FileRequestItem[],
  scopes: readonly SpeakerScope[] = [OWNER_SCOPE, CO_SCOPE],
): readonly DeliverableRow[] {
  return deliverableRows({ scopes, items, timeZone: TZ, codeBySubmission: CODES, now: NOW })
}

const rows = rowsFor([
  item({ id: 'a1', request: RELEASE }),
  item({ id: 'a2', request: BIO }),
  item({ id: 'a3', request: SLIDES, speakerId: CO_SPEAKER, submissionId: 'recSub1' }),
])
const base = { tab: 'all' as const, search: '', filters: [], sort: null }

describe('queryDeliverables', () => {
  it('narrows on the speaker and on the document title', () => {
    expect(queryDeliverables(rows, { ...base, search: 'Bo Lin' })).toHaveLength(1)
    expect(queryDeliverables(rows, { ...base, search: 'release' })).toHaveLength(1)
  })

  it('pins one speaker for the by-speaker drill-down', () => {
    expect(queryDeliverables(rows, { ...base, speakerId: OWNER })).toHaveLength(2)
  })

  it('keeps only the tab asked for, with overdue inside outstanding', () => {
    expect(queryDeliverables(rows, { ...base, tab: 'overdue' }).map((row) => row.title)).toEqual([
      'Signed speaker release',
    ])
    expect(queryDeliverables(rows, { ...base, tab: 'received' })).toEqual([])
  })

  it('applies a filter from the drawer over the same accessors', () => {
    const filtered = queryDeliverables(rows, {
      ...base,
      filters: [{ id: 'f0', key: 'deliverable-status', operator: 'is', value: 'Overdue' }],
    })

    expect(filtered.map((row) => row.title)).toEqual(['Signed speaker release'])
  })

  it('orders a deadline by its instant, not by the text of the label', () => {
    // `Aug 1` before `Sep 30` is the deadline order. Alphabetically it is the other way round,
    // which is exactly the bug a text sort would ship, and the undated row stays last in both
    // directions because it is never the answer to "what is due next".
    expect(
      queryDeliverables(rows, {
        ...base,
        sort: { key: 'deliverable-due', direction: 'asc' },
      }).map((row) => row.title),
    ).toEqual(['Signed speaker release', 'Slides', 'Bio as a document'])

    expect(
      queryDeliverables(rows, {
        ...base,
        sort: { key: 'deliverable-due', direction: 'desc' },
      }).map((row) => row.title),
    ).toEqual(['Slides', 'Signed speaker release', 'Bio as a document'])
  })

  it('every field the Columns and Filter panes offer has an accessor behind it', () => {
    const keys = new Set(DELIVERABLE_FIELDS.map((field) => field.key))
    expect(DELIVERABLE_CATALOG.queryableFields.every((field) => keys.has(field.key))).toBe(true)

    const row = rows[0]
    expect(row).toBeDefined()
    for (const field of DELIVERABLE_CATALOG.fields) {
      // `undefined` is what the engine reads as "this surface cannot answer that key", and it
      // makes both a filter and a sort on it a no-op. Every key offered has to be answerable.
      expect(DELIVERABLE_ACCESSORS.text(row, field.key)).toBeTypeOf('string')
    }
  })
})

describe('outstandingDeliverableRows', () => {
  it('groups what each person still owes, dropping what has arrived', () => {
    const delivered = rowsFor([
      item({ id: 'a1', request: RELEASE, received: true }),
      item({ id: 'a2', request: BIO }),
      item({ id: 'a3', request: SLIDES, speakerId: CO_SPEAKER, submissionId: 'recSub1' }),
    ])

    const behind = outstandingDeliverableRows(delivered)
    expect([...behind.map((row) => row.speakerId)].sort()).toEqual([CO_SPEAKER, OWNER].sort())
    expect(behind.find((row) => row.speakerId === CO_SPEAKER)?.deliverables).toEqual([
      {
        title: 'Slides (SESS-1)',
        dueLabel: 'Due Sep 30, 2026',
        dueAt: SLIDES.dueAt,
        required: true,
        overdue: false,
      },
    ])
  })

  it('drops a speaker with no address, who is not somebody who can be reminded', () => {
    const nameless: SpeakerScope = {
      speaker: speaker({ id: CO_SPEAKER, firstName: 'Bo', lastName: 'Lin', email: '  ' }),
      submissionIds: ['recSub1'],
    }
    const only = rowsFor([item({ id: 'a1', request: BIO, speakerId: CO_SPEAKER })], [nameless])

    expect(outstandingDeliverableRows(only)).toEqual([])
  })

  it('treats the ids as a filter over the people who are behind, and empty as everybody', () => {
    const behind = outstandingDeliverableRows(rows)

    expect(selectedOutstandingFiles(behind, [])).toHaveLength(2)
    expect(selectedOutstandingFiles(behind, [OWNER]).map((row) => row.speakerId)).toEqual([OWNER])
    expect(selectedOutstandingFiles(behind, [STRANGER])).toEqual([])
  })
})
