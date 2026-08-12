'use client'

// What the directory is filtered by, said out loud in the toolbar.
//
// THE DEFECT THIS CLOSES, reported independently by two eval agents: an applied filter was
// completely invisible. The Filter button looked identical filtered and unfiltered, no count
// appeared anywhere, no criteria chip was drawn, and the only trace of a narrowed table was
// the query string. A row count that has silently dropped from 40 to 3 reads as missing data,
// not as a filter, and the organizer's next move is to report the directory as broken.
//
// It sits in the DataTable's `toolbarViews` slot, immediately before Columns / Sort / Filter,
// beside the Lists control that occupies the same slot. That is as close to the Filter button
// as a surface can put a control of its own: `DataTableToolbar` is a shared primitive on six
// surfaces and badging its Filter button would change all of them, which is not this change's
// business. Everything the button would have shown is here, plus the two things a badge on it
// could not have: WHAT is applied, and a way back to the unfiltered table.
//
// `search` is deliberately not counted. The search box already shows its own text and carries
// its own clear button (`DataTableToolbar`), so folding it into this number would report a
// criterion the organizer can already see, in a control that would not clear it.
//
// COPY IS AUTHORED. The parity report waives the whole CRM area, so there is nothing to
// transcribe.

import { FunnelIcon, XIcon } from 'lucide-react'

import {
  type DataTableFilter,
  FILTER_OPERATOR_LABELS,
  UNARY_FILTER_OPERATORS,
} from '@/components/primitives/data-table-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SPEAKER_CRM_CATALOG } from '@/constants/speaker-crm-fields'

const FIELD_LABELS: ReadonlyMap<string, string> = new Map(
  SPEAKER_CRM_CATALOG.queryableFields.map((field) => [field.key, field.label]),
)

const OPERATOR_LABELS: ReadonlyMap<string, string> = new Map(
  FILTER_OPERATOR_LABELS.map((entry) => [entry.operator, entry.label]),
)

/**
 * One criterion as a sentence: `Company is Acme`, `Biography is empty`.
 *
 * The field's own label comes from the catalog rather than from the key, so a chip reads the
 * way the column header does. A key the catalog cannot name falls back to the key itself
 * instead of rendering a blank chip: the codec only parses keys the catalog offers
 * (`isQueryableKey`), so this is unreachable through the app, and a chip that says something
 * odd is still better than one that says nothing.
 *
 * A unary operator prints no value, matching the Filter pane, which hides the value input for
 * exactly those two (`UNARY_FILTER_OPERATORS`).
 */
export function filterCriterionText(filter: DataTableFilter): string {
  const field = FIELD_LABELS.get(filter.key) ?? filter.key
  const operator = OPERATOR_LABELS.get(filter.operator) ?? filter.operator
  if (UNARY_FILTER_OPERATORS.includes(filter.operator)) return `${field} ${operator}`
  return `${field} ${operator} ${filter.value}`
}

export type CrmFilterSummaryProps = {
  filters: readonly DataTableFilter[]
  /** Applies a narrowed set. The same navigation the Filter pane and Lists go through. */
  onChange: (filters: readonly DataTableFilter[]) => void
}

export function CrmFilterSummary({ filters, onChange }: CrmFilterSummaryProps) {
  // Nothing at all on an unfiltered table, so the toolbar does not carry a control reading
  // `Filters 0` that opens on an empty list. The same call the Duplicates toggle makes.
  if (filters.length === 0) return null

  return (
    <Popover>
      <PopoverTrigger
        render={
          // `default` and not `outline`: this is the ON state of a filter, and the whole
          // defect was that a filtered table looked exactly like an unfiltered one.
          <Button variant="default" aria-label={`${String(filters.length)} filters applied`}>
            <FunnelIcon data-icon="inline-start" />
            Filtered
            <Badge variant="secondary" className="tabular-nums">
              {filters.length}
            </Badge>
          </Button>
        }
      />
      <PopoverContent align="start" className="flex w-80 flex-col gap-2">
        <p className="font-medium text-sm">Filters applied</p>
        <ul className="flex flex-col gap-1">
          {filters.map((filter) => (
            <li key={filter.id} className="flex items-center gap-1">
              <Badge variant="outline" className="min-w-0 flex-1 justify-start font-normal">
                <span className="truncate">{filterCriterionText(filter)}</span>
              </Badge>
              <Button
                variant="ghost"
                size="icon-sm"
                // 28px, and 32px is the ceiling rather than 40: the rows are `gap-1`, so the
                // next row's remove button sits 28 + 4 = 32px below this one and two 32px
                // areas meet there exactly. `hit-area` would have overlapped by 8px.
                className="hit-area-[32px]"
                aria-label={`Remove filter: ${filterCriterionText(filter)}`}
                onClick={() => onChange(filters.filter((other) => other.id !== filter.id))}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
        {/* The way back to the whole directory, which is the thing an organizer looking at
            three rows out of forty actually wants. */}
        {/* Full width already, 28px tall, so `hit-area-y` and not `hit-area`. It reaches 6px
            up into the `gap-2` above, where the last remove button's 32px area reaches 2px
            down: 6 + 2 = 8, which is the gap, so they meet without crossing. */}
        <Button variant="outline" size="sm" className="hit-area-y" onClick={() => onChange([])}>
          Clear all filters
        </Button>
      </PopoverContent>
    </Popover>
  )
}
