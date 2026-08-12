'use client'

// The columns both Delivery status tables render, and the catalog each one's Columns picker
// offers. Split out of DeliveryStatus.tsx so neither file carries two tables' worth of cells.
//
// Each catalog names the columns ITS table actually has. Before this, both tables fell through
// to `DataTable`'s default catalog, which is the 22-field SESSION registry, so the Columns
// drawer over a table of speakers offered Track, Room and Abstract and committing a selection
// did nothing at all. Whatever a picker offers here has an accessor behind it.

import type { DataTableCatalog, DataTableColumn } from '@/components/primitives/data-table-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress, ProgressValue } from '@/components/ui/progress'
import type { RegistryField } from '@/constants/fields'
import type { DeliveryRow } from '@/features/file-requests/delivery'
import type { DeliverableRow } from '@/features/files/deliverables'

function StateBadge({ row }: { row: DeliverableRow }) {
  if (row.state === 'received') return <Badge variant="secondary">{row.statusLabel}</Badge>
  if (row.state === 'overdue') return <Badge variant="destructive">{row.statusLabel}</Badge>
  return <Badge variant="outline">{row.statusLabel}</Badge>
}

/** One row per (speaker, requested document), which is the pair the criterion asks for. */
export const DELIVERABLE_COLUMNS: readonly DataTableColumn<DeliverableRow>[] = [
  {
    key: 'deliverable-speaker',
    cell: (row) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.speakerName}</span>
        <span className="text-xs text-muted-foreground">{row.email}</span>
      </div>
    ),
  },
  {
    key: 'deliverable-title',
    cell: (row) => (
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{row.title}</span>
        {row.required ? <Badge variant="outline">Required</Badge> : null}
      </span>
    ),
  },
  {
    key: 'deliverable-session',
    cell: (row) => row.sessionCode ?? '-',
  },
  {
    key: 'deliverable-status',
    cell: (row) => <StateBadge row={row} />,
  },
  {
    key: 'deliverable-due',
    cellClassName: 'whitespace-nowrap',
    cell: (row) =>
      row.dueDate === undefined ? (
        <span className="text-muted-foreground">No due date</span>
      ) : (
        <span className={row.state === 'overdue' ? 'font-medium text-destructive' : undefined}>
          {row.dueDate}
        </span>
      ),
  },
  {
    key: 'deliverable-received',
    cellClassName: 'whitespace-nowrap',
    cell: (row) => row.receivedDate ?? <span className="text-muted-foreground">-</span>,
  },
  {
    key: 'deliverable-progress',
    cellClassName: 'w-48',
    cell: (row) => (
      // `aria-label`, because the primitive's own `aria-valuetext` is a percentage, so a
      // screen reader would announce "33%" where the sighted label reads `1/3`.
      <Progress
        value={row.speakerPercent}
        className="min-w-32"
        aria-label={`${row.speakerName}: ${row.speakerLabel} delivered`}
      >
        <ProgressValue>{() => row.speakerLabel}</ProgressValue>
      </Progress>
    ),
  },
]

const SPEAKER_DELIVERY_FIELDS: readonly RegistryField[] = [
  {
    key: 'delivery-speaker',
    label: 'Speaker',
    type: 'text',
    group: 'participant',
    column: false,
    defaultVisible: true,
    help: 'One row per accepted speaker. Everything requested of them, folded into one line.',
  },
  {
    key: 'delivery-progress',
    label: 'Delivered',
    type: 'number',
    group: 'reporting',
    column: false,
    defaultVisible: true,
    help: 'Documents received against documents requested. A speaker with nothing requested reads 0/0.',
  },
  {
    key: 'delivery-missing',
    label: 'Missing',
    type: 'text',
    group: 'session',
    column: false,
    defaultVisible: true,
    help: 'What is still outstanding. Open the full list on the By deliverable tab, one row per document with its own due date.',
  },
]

export const SPEAKER_DELIVERY_CATALOG: DataTableCatalog = {
  fields: SPEAKER_DELIVERY_FIELDS,
  queryableFields: SPEAKER_DELIVERY_FIELDS,
  defaultColumnKeys: SPEAKER_DELIVERY_FIELDS.map((field) => field.key),
}

export const SPEAKER_DELIVERY_COLUMN_KEYS: readonly string[] =
  SPEAKER_DELIVERY_CATALOG.defaultColumnKeys

const MISSING_SHOWN = 2

/**
 * The aggregate row, with its Missing cell now a DRILL-DOWN rather than a truncation.
 *
 * `and N more` was plain text: a speaker owing four documents showed two titles and a number,
 * and nothing on the row could open the rest. It is a control now, and so is the count on a
 * row whose titles all fit, so the way to the per-document list is the same gesture either way.
 */
export function speakerDeliveryColumns(
  onDrillDown: (row: DeliveryRow) => void,
): readonly DataTableColumn<DeliveryRow>[] {
  return [
    {
      key: 'delivery-speaker',
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.name}</span>
          <span className="text-xs text-muted-foreground">{row.email}</span>
        </div>
      ),
    },
    {
      key: 'delivery-progress',
      cellClassName: 'w-56',
      cell: (row) => (
        <Progress value={row.percent} className="min-w-40" aria-label={`${row.name}: ${row.label}`}>
          <ProgressValue>{() => row.label}</ProgressValue>
        </Progress>
      ),
    },
    {
      key: 'delivery-missing',
      cell: (row) =>
        row.requested === 0 ? (
          <span className="text-muted-foreground">Nothing requested</span>
        ) : row.outstanding === 0 ? (
          <Badge variant="secondary">All received</Badge>
        ) : (
          <span className="flex flex-wrap items-center gap-2 text-sm">
            {row.outstandingTitles.slice(0, MISSING_SHOWN).join(', ')}
            {row.missingRequired ? <Badge variant="destructive">Required</Badge> : null}
            <Button variant="link" size="xs" className="px-0" onClick={() => onDrillDown(row)}>
              {row.outstandingTitles.length > MISSING_SHOWN
                ? `and ${String(row.outstandingTitles.length - MISSING_SHOWN)} more`
                : 'Open'}
            </Button>
          </span>
        ),
    },
  ]
}
