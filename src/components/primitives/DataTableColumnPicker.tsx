'use client'

// The Preferences drawer's left pane: the typed field catalog, grouped, searchable,
// with a checkbox per field.
//
// The catalog arrives as a prop. It used to be read straight out of
// src/constants/fields.ts, which was right while every table on this primitive was a table
// of submissions; the speaker CRM is a table of people, and offering it Track and Room
// would be offering columns its rows cannot answer. A field added to the registry still
// appears here, in the form builder's picker and in Event Settings > Library > Fields
// without a second edit, because the default catalog is that registry.

import { HashIcon, TypeIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { FieldPill } from '@/components/primitives/data-table-types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { type FieldGroup, fieldsForPill, type RegistryField } from '@/constants/fields'
import { FIELD_TYPE_LABELS, type FieldType } from '@/types/forms'

/**
 * Group headers as the audit transcribed them, uppercase. Maps, not record
 * indexing, throughout this file: `security/detect-object-injection` warns on a
 * computed index into a plain object and that warning fails the build.
 */
const GROUP_LABELS: ReadonlyMap<FieldGroup, string> = new Map([
  ['session', 'SESSION DETAILS'],
  ['classification', 'CLASSIFICATION'],
  ['scheduling', 'SCHEDULING'],
  ['participant', 'PARTICIPANT'],
  ['reporting', 'REPORTING FIELDS'],
])

const TYPE_LABELS: ReadonlyMap<FieldType, string> = new Map(
  Object.entries(FIELD_TYPE_LABELS).map(([type, label]) => [type as FieldType, label]),
)

/** Finished elements, not components: a component pulled from a lookup during
 * render trips `react-hooks/static-components`. */
const NUMBER_ICON: ReactNode = <HashIcon key="number" className="text-muted-foreground" />
const TEXT_ICON: ReactNode = <TypeIcon key="text" className="text-muted-foreground" />

function typeIcon(type: FieldType): ReactNode {
  return type === 'number' ? NUMBER_ICON : TEXT_ICON
}

function typeLabel(type: FieldType): string {
  return TYPE_LABELS.get(type) ?? type
}

function groupLabel(group: FieldGroup): string {
  return GROUP_LABELS.get(group) ?? group.toUpperCase()
}

/** Registry order is meaningful, so groups come out in first-appearance order. */
function groupFields(
  fields: readonly RegistryField[],
): readonly { group: FieldGroup; fields: readonly RegistryField[] }[] {
  const groups = new Map<FieldGroup, RegistryField[]>()
  for (const field of fields) {
    const bucket = groups.get(field.group)
    if (bucket === undefined) {
      groups.set(field.group, [field])
    } else {
      bucket.push(field)
    }
  }
  return [...groups].map(([group, groupedFields]) => ({ group, fields: groupedFields }))
}

export type DataTableColumnPickerProps = {
  pill: FieldPill
  onPillChange: (pill: FieldPill) => void
  /** The surface's column catalog. `DataTableCatalog.fields`. */
  fields: readonly RegistryField[]
  selectedKeys: readonly string[]
  onToggle: (key: string, selected: boolean) => void
  onShowAll: () => void
  onHideAll: () => void
}

export function DataTableColumnPicker({
  pill,
  onPillChange,
  fields: allFields,
  selectedKeys,
  onToggle,
  onShowAll,
  onHideAll,
}: DataTableColumnPickerProps) {
  const catalog = fieldsForPill(pill, allFields)
  const selected = new Set(selectedKeys)

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <ToggleGroup
        value={[pill]}
        onValueChange={(next) => {
          // Clicking the active pill clears the group; keep the current pill
          // rather than leaving the pane with no catalog selected. The narrowing
          // is a check rather than a cast because the shadcn wrapper widens the
          // primitive's value type to `string`.
          const candidate = next[0]
          if (candidate === 'fields' || candidate === 'reporting') {
            onPillChange(candidate)
          }
        }}
        variant="outline"
        size="sm"
      >
        <ToggleGroupItem value="fields">Fields</ToggleGroupItem>
        <ToggleGroupItem value="reporting">Reporting Fields</ToggleGroupItem>
      </ToggleGroup>

      <div className="flex items-center gap-1">
        <Button variant="link" size="xs" onClick={onShowAll}>
          Show All
        </Button>
        <Button variant="link" size="xs" onClick={onHideAll}>
          Hide All
        </Button>
      </div>

      <Command className="min-h-0 flex-1 border border-border p-0">
        <CommandInput placeholder="Search columns..." />
        <CommandList className="max-h-none flex-1">
          <CommandEmpty>No columns found.</CommandEmpty>
          {groupFields(catalog).map(({ group, fields }) => {
            const shown = fields.filter((field) => selected.has(field.key)).length
            return (
              <CommandGroup
                key={group}
                // The shown/total pair moves on every checkbox in the group, so the
                // heading is set in tabular figures rather than letting the group
                // label shuffle sideways as the count crosses a narrow digit.
                className="**:[[cmdk-group-heading]]:tabular-nums"
                heading={`${groupLabel(group)} (${shown}/${fields.length})`}
              >
                {fields.map((field) => {
                  const isSelected = selected.has(field.key)
                  return (
                    <CommandItem
                      key={field.key}
                      value={`${field.label} ${typeLabel(field.type)}`}
                      onSelect={() => onToggle(field.key, !isSelected)}
                    >
                      {/* Visual only: the row owns the toggle, so a second
                          handler here would fire twice and cancel itself out. */}
                      <Checkbox
                        checked={isSelected}
                        tabIndex={-1}
                        className="pointer-events-none"
                      />
                      {typeIcon(field.type)}
                      <span className="truncate">{field.label}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {typeLabel(field.type)}
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )
          })}
        </CommandList>
      </Command>
    </div>
  )
}
