'use client'

// The Preferences drawer's Sort and Filter panes. The audit did not capture either
// tab's contents (docs/parity/abstracts-review.md, Ambiguities), so these are built
// generically over the same field registry the Columns tab reads rather than
// invented to look like a screenshot nobody has.
//
// WHICH FIELDS ARE OFFERED is the caller's answer, not the registry's, and these panes no
// longer work it out at all: `DataTablePreferences` resolves one list and hands it down.
// That is deliberate, because the answer has two independent inputs and computing it twice
// is how the Sort tab and the Filter tab start disagreeing about what exists.
//
// The two inputs, both real:
//
//   - The CATALOG. These panes used to read `src/constants/fields.ts` directly, which was
//     right while every table over this primitive was a table of submissions. The speaker
//     CRM's rows are people, so a Filter pane offering Track would be a control that
//     silently does nothing. `DataTableCatalog.queryableFields` is the surface's own list.
//   - The SURFACE'S ACCESSORS. Within one catalog, the default is `column: true`, which
//     means "there is a real Airtable column behind this" and is a fact about the schema.
//     Sorting and filtering happen in code, over rows already loaded, so the schema has no
//     say: what decides is whether the surface can read a value for that key. Ratings is
//     derived from Reviews and has no Submissions column, so `column` is false and the
//     picker silently dropped the one column an organizer most wants to rank by. A surface
//     with derived columns passes `sortableKeys` and gets to say so.
//
// A key the caller cannot answer would be worse than an absent one: the sort would be a
// control that visibly does nothing, and the filter would match every row.

import { PlusIcon, XIcon } from 'lucide-react'
import { nanoid } from 'nanoid'
import {
  type DataTableFilter,
  type DataTableSort,
  FILTER_OPERATOR_LABELS,
  type FilterOperator,
  UNARY_FILTER_OPERATORS,
} from '@/components/primitives/data-table-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { RegistryField } from '@/constants/fields'

const FIELD_PLACEHOLDER = 'Select field...'

function FieldSelect({
  value,
  fields,
  onValueChange,
}: {
  value: string | null
  fields: readonly RegistryField[]
  onValueChange: (key: string) => void
}) {
  return (
    <Select
      // Base UI's `Select.Value` prints the raw value unless the root carries this map, and
      // a field's value is its registry KEY. Without it a picked field read `starts_at` on
      // the closed trigger and "Starts At" in the list.
      items={Object.fromEntries(fields.map((field) => [field.key, field.label]))}
      value={value}
      onValueChange={(next: string | null) => {
        if (next !== null) {
          onValueChange(next)
        }
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={FIELD_PLACEHOLDER} />
      </SelectTrigger>
      <SelectContent>
        {fields.map((field) => (
          <SelectItem key={field.key} value={field.key}>
            {field.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export type DataTableSortPaneProps = {
  sort: DataTableSort | null
  /** What this surface can be ordered by, already resolved by `DataTablePreferences`. */
  fields: readonly RegistryField[]
  onChange: (sort: DataTableSort | null) => void
}

export function DataTableSortPane({ sort, fields, onChange }: DataTableSortPaneProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Sort by</Label>
        <FieldSelect
          value={sort === null ? null : sort.key}
          fields={fields}
          onValueChange={(key) => onChange({ key, direction: sort?.direction ?? 'asc' })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Direction</Label>
        <ToggleGroup
          value={sort === null ? [] : [sort.direction]}
          onValueChange={(next) => {
            const candidate = next[0]
            if (sort !== null && (candidate === 'asc' || candidate === 'desc')) {
              onChange({ key: sort.key, direction: candidate })
            }
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="asc" disabled={sort === null}>
            Ascending
          </ToggleGroupItem>
          <ToggleGroupItem value="desc" disabled={sort === null}>
            Descending
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        disabled={sort === null}
        onClick={() => onChange(null)}
      >
        <XIcon data-icon="inline-start" />
        Clear sort
      </Button>
    </div>
  )
}

export type DataTableFilterPaneProps = {
  filters: readonly DataTableFilter[]
  /** The same set the Sort pane offers: a key with no accessor matches every row. */
  fields: readonly RegistryField[]
  onChange: (filters: readonly DataTableFilter[]) => void
}

export function DataTableFilterPane({ filters, fields, onChange }: DataTableFilterPaneProps) {
  const replace = (id: string, patch: Partial<DataTableFilter>) => {
    onChange(filters.map((filter) => (filter.id === id ? { ...filter, ...patch } : filter)))
  }

  return (
    <div className="flex flex-col gap-3">
      {filters.length === 0 ? (
        <p className="text-sm text-muted-foreground">No filters applied.</p>
      ) : null}

      {filters.map((filter) => (
        <div key={filter.id} className="flex flex-col gap-1.5 rounded-lg border border-border p-2">
          <FieldSelect
            value={filter.key}
            fields={fields}
            onValueChange={(key) => replace(filter.id, { key })}
          />
          <div className="flex items-center gap-1.5">
            <Select
              // Same reason as the field picker above: the operator's value is its slug, so
              // the closed trigger read `is_not` rather than "is not".
              items={Object.fromEntries(
                FILTER_OPERATOR_LABELS.map((entry) => [entry.operator, entry.label]),
              )}
              value={filter.operator}
              onValueChange={(operator: FilterOperator | null) => {
                if (operator !== null) {
                  replace(filter.id, { operator })
                }
              }}
            >
              <SelectTrigger className="w-36 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTER_OPERATOR_LABELS.map((entry) => (
                  <SelectItem key={entry.operator} value={entry.operator}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {UNARY_FILTER_OPERATORS.includes(filter.operator) ? null : (
              <Input
                value={filter.value}
                placeholder="Value"
                onChange={(event) => replace(filter.id, { value: event.target.value })}
              />
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto shrink-0"
              onClick={() => onChange(filters.filter((entry) => entry.id !== filter.id))}
            >
              <XIcon />
              <span className="sr-only">Remove filter</span>
            </Button>
          </div>
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        className="self-start"
        // Disabled rather than adding a filter on a key no field owns: a catalog can be
        // empty, and `fields[0]` on an empty catalog is `undefined` at runtime whatever
        // the index signature claims.
        disabled={fields.length === 0}
        onClick={() => {
          const first = fields.at(0)
          if (first === undefined) return
          onChange([...filters, { id: nanoid(), key: first.key, operator: 'is', value: '' }])
        }}
      >
        <PlusIcon data-icon="inline-start" />
        Add filter
      </Button>
    </div>
  )
}
