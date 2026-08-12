'use client'

// The grid itself: header row, selection column, row-action column, cells, and the
// empty state. Split out of DataTable.tsx so neither file carries the whole surface's
// branching, and so the header's registry-driven tooltip has one home.

import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, InfoIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type {
  DataTableColumn,
  DataTableDensity,
  DataTableSort,
} from '@/components/primitives/data-table-types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { RegistryField } from '@/constants/fields'
import { cn } from '@/utils/cn'

const DENSITY_CELL: ReadonlyMap<DataTableDensity, string> = new Map([
  ['compact', 'py-1'],
  ['default', 'py-2'],
  ['relaxed', 'py-3.5'],
])

/**
 * A header cell. The label and the tooltip both fall back through the caller's override,
 * then the surface's field catalog, then (for the label) the raw key.
 *
 * The catalog is checked FIRST for help, so a surface cannot write its own version of an
 * explanation the registry already owns. The caller's `help` only fills a gap: the audit
 * requires the info icon on EVERY header, and two of the Abstracts columns (Session
 * Submitter, Speaker) describe a submission's cast rather than a registry field, so the
 * registry has nothing to say about them and never will.
 *
 * The catalog arrives as a prop rather than being read out of `src/constants/fields.ts`,
 * because one key means different things on different surfaces: `tags` is a session's
 * classification on Abstracts and a person's cross-event CRM label in the directory, and a
 * global lookup would print the wrong explanation on one of them.
 */
function GridHeaderCell<TRow>({
  column,
  field,
  sort,
  sortable,
  onSortChange,
}: {
  column: DataTableColumn<TRow>
  field: RegistryField | undefined
  sort: DataTableSort | null
  sortable: boolean
  onSortChange?: (sort: DataTableSort | null) => void
}) {
  const label = column.label ?? field?.label ?? column.key
  const help = field?.help ?? column.help

  const active = sort !== null && sort.key === column.key
  const direction = active ? sort.direction : undefined

  const info =
    help === undefined ? null : (
      <Tooltip>
        <TooltipTrigger className="text-muted-foreground">
          <InfoIcon className="size-3.5" />
          <span className="sr-only">About {label}</span>
        </TooltipTrigger>
        <TooltipContent>{help}</TooltipContent>
      </Tooltip>
    )

  if (!sortable || onSortChange === undefined) {
    return (
      <TableHead className={column.headerClassName}>
        <span className="inline-flex items-center gap-1">
          {label}
          {info}
        </span>
      </TableHead>
    )
  }

  return (
    // `aria-sort` belongs on the header CELL, not on the button inside it: the role that
    // carries it is columnheader. Only the active column gets a value; the rest are
    // omitted rather than set to "none", so a screen reader announces one sorted column
    // instead of every column announcing that it is not sorted.
    <TableHead className={column.headerClassName} aria-sort={ariaSort(direction)}>
      <span className="inline-flex items-center gap-1">
        <Button
          variant="ghost"
          size="xs"
          className="-mx-1 h-auto px-1 py-0.5 font-medium"
          // Three states, not two: ascending, descending, then back to unsorted. An
          // organizer who sorted by Ratings to find the top of the list needs a way back
          // to the order the rows arrived in, and a two-state toggle leaves them
          // permanently sorted by whatever they clicked last.
          onClick={() => onSortChange(nextSort(column.key, sort))}
        >
          {label}
          <SortIcon direction={direction} />
        </Button>
        {info}
      </span>
    </TableHead>
  )
}

function ariaSort(direction: 'asc' | 'desc' | undefined): 'ascending' | 'descending' | undefined {
  if (direction === undefined) return undefined
  return direction === 'asc' ? 'ascending' : 'descending'
}

function nextSort(key: string, sort: DataTableSort | null): DataTableSort | null {
  if (sort === null || sort.key !== key) return { key, direction: 'asc' }
  return sort.direction === 'asc' ? { key, direction: 'desc' } : null
}

function SortIcon({ direction }: { direction: 'asc' | 'desc' | undefined }) {
  if (direction === 'asc') return <ArrowUpIcon className="size-3.5" aria-hidden />
  if (direction === 'desc') return <ArrowDownIcon className="size-3.5" aria-hidden />
  // Shown at reduced contrast on every sortable column, so the affordance is visible
  // before anybody clicks it. The audit's finding was that the header carried no sort
  // affordance at all, which a hover-only icon would only half fix.
  return <ChevronsUpDownIcon className="size-3.5 text-muted-foreground/60" aria-hidden />
}

export type DataTableGridProps<TRow> = {
  rows: readonly TRow[]
  rowId: (row: TRow) => string
  /** Already ordered and resolved against the caller's cell renderers. */
  columns: readonly DataTableColumn<TRow>[]
  /** The surface's field catalog, for header labels and tooltips. */
  fields: readonly RegistryField[]
  selectable: boolean
  selection: ReadonlySet<string>
  onSelectionChange?: (ids: readonly string[]) => void
  rowActions?: (row: TRow) => ReactNode
  density: DataTableDensity
  emptyMessage: string
  /** The current sort, so the sorted header can show and announce which one it is. */
  sort?: DataTableSort | null
  /** Keys whose headers are clickable. Omit to render every header inert, as before. */
  sortableKeys?: ReadonlySet<string>
  onSortChange?: (sort: DataTableSort | null) => void
}

export function DataTableGrid<TRow>({
  rows,
  rowId,
  columns,
  fields,
  selectable,
  selection,
  onSelectionChange,
  rowActions,
  density,
  emptyMessage,
  sort = null,
  sortableKeys,
  onSortChange,
}: DataTableGridProps<TRow>) {
  const padding = DENSITY_CELL.get(density) ?? ''
  // A Map, not a `.find` per header: `security/detect-object-injection` aside, the
  // catalog is 25 fields wide and the header row renders on every keystroke.
  const fieldByKey = new Map(fields.map((field) => [field.key, field]))
  const pageIds = rows.map(rowId)
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selection.has(id))
  const leadingColumns = (selectable ? 1 : 0) + (rowActions === undefined ? 0 : 1)

  const toggleRow = (id: string, checked: boolean) => {
    const next = new Set(selection)
    if (checked) {
      next.add(id)
    } else {
      next.delete(id)
    }
    onSelectionChange?.([...next])
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {selectable ? (
            <TableHead className="w-8 pl-3">
              <Checkbox
                checked={allSelected}
                indeterminate={!allSelected && pageIds.some((id) => selection.has(id))}
                onCheckedChange={(checked) =>
                  onSelectionChange?.(checked ? [...selection, ...pageIds] : [])
                }
              />
              <span className="sr-only">Select all rows on this page</span>
            </TableHead>
          ) : null}
          {rowActions === undefined ? null : <TableHead className="w-8" />}
          {columns.map((column) => (
            <GridHeaderCell
              key={column.key}
              column={column}
              field={fieldByKey.get(column.key)}
              sort={sort}
              sortable={sortableKeys?.has(column.key) ?? false}
              onSortChange={onSortChange}
            />
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={columns.length + leadingColumns}
              className="py-10 text-center text-pretty text-muted-foreground"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : null}
        {rows.map((row) => {
          const id = rowId(row)
          const checked = selection.has(id)
          return (
            <TableRow key={id} data-state={checked ? 'selected' : undefined}>
              {selectable ? (
                <TableCell className={cn('pl-3', padding)}>
                  <Checkbox checked={checked} onCheckedChange={(next) => toggleRow(id, next)} />
                  <span className="sr-only">Select row</span>
                </TableCell>
              ) : null}
              {rowActions === undefined ? null : (
                <TableCell className={padding}>{rowActions(row)}</TableCell>
              )}
              {columns.map((column) => (
                <TableCell key={column.key} className={cn(padding, column.cellClassName)}>
                  {column.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
