// The deliverables table's own column catalog, accessors, and query.
//
// It exists because the Columns picker on this surface was a DEAD CONTROL in both possible
// ways at once. `DataTable`'s `catalog` prop defaults to `SESSION_CATALOG`, so the drawer over
// a table of speakers offered the 22 SESSION fields (Track, Room, Abstract), and the surface
// passed `onPreferencesApply={() => undefined}`, so ticking one and pressing Apply Changes
// committed nothing. Verified in the code before it was changed, not inferred from the report:
// DataTable.tsx line 112 for the default, and the old DeliveryStatus.tsx for the no-op.
//
// So the catalog below names the columns this table actually has, and the surface commits what
// the drawer returns. The query runs over the row model through the shared in-memory engine
// (`features/views/table-query.ts`), the same one the speaker CRM uses, rather than a second
// filter implementation.
//
// Pure, and tested in tests/files-deliverable-query.test.ts.

import type {
  DataTableCatalog,
  DataTableFilter,
  DataTableSort,
} from '@/components/primitives/data-table-types'
import type { RegistryField } from '@/constants/fields'
import {
  type DeliverableRow,
  type DeliverableTab,
  deliverableTitle,
  keepForTab,
} from '@/features/files/deliverables'
import {
  matchesFilters,
  matchesSearch,
  type RowAccessors,
  sortRows,
} from '@/features/views/table-query'

export const DELIVERABLE_FIELDS: readonly RegistryField[] = [
  {
    key: 'deliverable-speaker',
    label: 'Speaker',
    type: 'text',
    group: 'participant',
    column: false,
    defaultVisible: true,
    help: 'Who owes the document. One row per person per requested document.',
  },
  {
    key: 'deliverable-title',
    label: 'Deliverable',
    type: 'text',
    group: 'session',
    column: false,
    defaultVisible: true,
    help: 'The file request this row is, and whether it is marked required.',
  },
  {
    key: 'deliverable-session',
    label: 'Session',
    type: 'text',
    group: 'session',
    column: false,
    defaultVisible: true,
    help: 'The accepted session a per-session request is owed for. Blank for a contact or group request.',
  },
  {
    key: 'deliverable-status',
    label: 'Status',
    type: 'select',
    group: 'session',
    column: false,
    defaultVisible: true,
    help: 'Delivered once a verified file lands against the row. Overdue is outstanding past its due date.',
  },
  {
    key: 'deliverable-due',
    label: 'Due',
    type: 'datetime',
    group: 'scheduling',
    column: false,
    defaultVisible: true,
    help: "The request's deadline, at the end of that day in the event's timezone.",
  },
  {
    key: 'deliverable-received',
    label: 'Delivered on',
    type: 'datetime',
    group: 'scheduling',
    column: false,
    defaultVisible: true,
    help: 'When the file arrived. Blank while the document is still outstanding.',
  },
  {
    key: 'deliverable-progress',
    label: 'Speaker progress',
    type: 'number',
    group: 'reporting',
    column: false,
    defaultVisible: false,
    help: "How much of this person's whole list has arrived, so one pair row still carries their overall state.",
  },
]

export const DELIVERABLE_DEFAULT_COLUMN_KEYS: readonly string[] = DELIVERABLE_FIELDS.filter(
  (field) => field.defaultVisible,
).map((field) => field.key)

/**
 * Every column is queryable, which is the honest answer here rather than the generous one:
 * this table filters in memory over the row model below, so a derived column is exactly as
 * answerable as a stored one. The submission catalog offers only `column: true` fields because
 * Airtable does that surface's filtering and cannot look inside a JSON blob.
 */
export const DELIVERABLE_CATALOG: DataTableCatalog = {
  fields: DELIVERABLE_FIELDS,
  queryableFields: DELIVERABLE_FIELDS,
  defaultColumnKeys: DELIVERABLE_DEFAULT_COLUMN_KEYS,
}

/** Every key the drawer offers has an accessor here, which is what makes the pane honest. */
const TEXT: ReadonlyMap<string, (row: DeliverableRow) => string> = new Map([
  ['deliverable-speaker', (row: DeliverableRow) => `${row.speakerName} ${row.email}`],
  ['deliverable-title', (row: DeliverableRow) => deliverableTitle(row)],
  ['deliverable-session', (row: DeliverableRow) => row.sessionCode ?? ''],
  ['deliverable-status', (row: DeliverableRow) => row.statusLabel],
  ['deliverable-due', (row: DeliverableRow) => row.dueDate ?? ''],
  ['deliverable-received', (row: DeliverableRow) => row.receivedDate ?? ''],
  ['deliverable-progress', (row: DeliverableRow) => row.speakerLabel],
])

/**
 * Dates sort on their INSTANT and filter on their label.
 *
 * Sorting the rendered text would put `Mar 3` before `Nov 1` before `Sep 9`, which is
 * alphabetical and is not a deadline order. The engine's numeric branch also puts an undated
 * row last in BOTH directions, which is what an organizer means either way: a request with no
 * deadline is never the answer to "what is due next" or "what is furthest overdue".
 */
const NUMERIC: ReadonlyMap<string, (row: DeliverableRow) => number | undefined> = new Map([
  ['deliverable-due', (row: DeliverableRow) => instant(row.dueAt)],
  ['deliverable-received', (row: DeliverableRow) => instant(row.receivedAt)],
  ['deliverable-progress', (row: DeliverableRow) => row.speakerPercent],
])

function instant(iso: string | undefined): number | undefined {
  if (iso === undefined) return undefined
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? undefined : parsed
}

export const DELIVERABLE_ACCESSORS: RowAccessors<DeliverableRow> = {
  text: (row, key) => TEXT.get(key)?.(row),
  numeric: (key) => NUMERIC.has(key),
  number: (row, key) => NUMERIC.get(key)?.(row),
  searchableKeys: [
    'deliverable-speaker',
    'deliverable-title',
    'deliverable-session',
    'deliverable-status',
  ],
}

export type DeliverableQuery = {
  tab: DeliverableTab
  search: string
  filters: readonly DataTableFilter[]
  sort: DataTableSort | null
  /** Set by the by-speaker table's drill-down. Omitted means every speaker. */
  speakerId?: string
}

/** Tab, then the speaker drill-down, then search, then the drawer's filters, then its sort. */
export function queryDeliverables(
  rows: readonly DeliverableRow[],
  query: DeliverableQuery,
): readonly DeliverableRow[] {
  const matched = rows.filter(
    (row) =>
      keepForTab(row, query.tab) &&
      (query.speakerId === undefined || row.speakerId === query.speakerId) &&
      matchesSearch(row, query.search, DELIVERABLE_ACCESSORS) &&
      matchesFilters(row, query.filters, DELIVERABLE_ACCESSORS),
  )
  return sortRows(matched, query.sort, DELIVERABLE_ACCESSORS)
}
