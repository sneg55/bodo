'use client'

// Step two of the create wizard, and the same control on an existing portal's settings.
// BUILD_SPEC 5.0c: "filters (contact fields, or select session fields: format, track, tag,
// level, language)".
//
// Two questions, and they are separate because the vendor asks them separately: WHO the
// portal is for (the contact types), and then WHICH of those (the rules). An empty type
// list means every type, and an empty rule list means every contact of those types, which
// is why the summary line under the heading spells out what the current combination
// selects rather than leaving an organizer to infer it from two empty boxes.
//
// Rules are ANDed. An OR across two different fields is deliberately not expressible: it is
// a second portal, which is the mechanism this feature already has, and one portal whose
// membership needs a boolean tree cannot be debugged from the list screen.
//
// Values are entered differently per field and the split is not cosmetic. `track` and `tag`
// carry RECORD IDS (types/portals.ts), because a name silently stops matching the moment an
// organizer renames a track, so those two are pickers over the event's own records. `role`
// is a fixed vocabulary. The rest are free text, matched case- and whitespace-insensitively
// by `matchesText`, so they are one comma-separated field: the values are a set the rule
// matches ANY of, and "Track is Platform or Security" is one rule rather than two.

import { XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  PORTAL_CONTACT_TYPES,
  PORTAL_FILTER_FIELDS,
  type PortalContactType,
  type PortalFilterField,
  type PortalFilterOperator,
  type PortalFilterRule,
} from '@/types/portals'
import { type FilterOption, RuleValues } from './PortalFilterValues'
import {
  CONTACT_TYPE_LABELS,
  FILTER_FIELD_LABELS,
  FILTER_OPERATOR_LABELS,
  labelOf,
} from './portal-filter-labels'

// Re-exported because the wizard and the settings panel both import it from here, and the
// type did not move for their benefit: `RuleValues` owns it now, and it went with it.
export type { FilterOption }

export type PortalFilterEditorProps = {
  contactTypes: readonly PortalContactType[]
  onContactTypesChange: (next: readonly PortalContactType[]) => void
  rules: readonly PortalFilterRule[]
  onRulesChange: (next: readonly PortalFilterRule[]) => void
  tracks: readonly FilterOption[]
  tags: readonly FilterOption[]
  disabled?: boolean
}

export function PortalFilterEditor({
  contactTypes,
  onContactTypesChange,
  rules,
  onRulesChange,
  tracks,
  tags,
  disabled = false,
}: PortalFilterEditorProps) {
  const chosen = new Set(contactTypes)

  function replace(index: number, patch: Partial<PortalFilterRule>): void {
    onRulesChange(rules.map((rule, at) => (at === index ? { ...rule, ...patch } : rule)))
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <div>
          <h3 className="text-sm font-medium">Contact types</h3>
          <p className="text-xs text-muted-foreground">
            {contactTypes.length === 0
              ? 'Every contact type. Pick some to narrow it.'
              : 'A contact holding any one of these qualifies.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {CONTACT_TYPE_LABELS.map((entry) => (
            <Label key={entry.value} className="flex items-center gap-2 font-normal">
              <Checkbox
                checked={chosen.has(entry.value)}
                disabled={disabled}
                onCheckedChange={(checked: boolean) => {
                  onContactTypesChange(
                    checked
                      ? [...contactTypes, entry.value]
                      : contactTypes.filter((value) => value !== entry.value),
                  )
                }}
              />
              {entry.label}
            </Label>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div>
          <h3 className="text-sm font-medium">Filters</h3>
          <p className="text-xs text-muted-foreground">
            Every filter has to hold. A session filter holds when any one of the contact&apos;s
            sessions matches.
          </p>
        </div>

        {rules.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            No filters. Every contact of the types above lands here.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rules.map((rule, index) => (
              <li
                key={`${rule.field}-${String(index)}`}
                className="flex flex-wrap items-center gap-2"
              >
                <Select
                  // Base UI's `Select.Value` prints the raw value unless the root carries
                  // this map, so the closed trigger read the slug while the list read the
                  // label. Both selects on this row had it.
                  items={Object.fromEntries(
                    PORTAL_FILTER_FIELDS.map((field) => [
                      field,
                      labelOf(FILTER_FIELD_LABELS, field),
                    ]),
                  )}
                  value={rule.field}
                  onValueChange={(next: PortalFilterField | null) => {
                    // Values are cleared with the field, because a track id means nothing
                    // as a Level and an empty rule matches nobody rather than everybody.
                    if (next !== null) replace(index, { field: next, values: [] })
                  }}
                >
                  <SelectTrigger className="w-36 shrink-0" disabled={disabled}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PORTAL_FILTER_FIELDS.map((field) => (
                      <SelectItem key={field} value={field}>
                        {labelOf(FILTER_FIELD_LABELS, field)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  items={Object.fromEntries(
                    FILTER_OPERATOR_LABELS.map((entry) => [entry.value, entry.label]),
                  )}
                  value={rule.operator}
                  onValueChange={(next: PortalFilterOperator | null) => {
                    if (next !== null) replace(index, { operator: next })
                  }}
                >
                  <SelectTrigger className="w-28 shrink-0" disabled={disabled}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FILTER_OPERATOR_LABELS.map((entry) => (
                      <SelectItem key={entry.value} value={entry.value}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <RuleValues
                  rule={rule}
                  tracks={tracks}
                  tags={tags}
                  disabled={disabled}
                  onValuesChange={(values) => {
                    replace(index, { values })
                  }}
                />

                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={disabled}
                  onClick={() => {
                    onRulesChange(rules.filter((_, at) => at !== index))
                  }}
                >
                  <XIcon />
                  <span className="sr-only">{`Remove the ${labelOf(FILTER_FIELD_LABELS, rule.field)} filter`}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => {
              onRulesChange([...rules, { field: 'track', operator: 'is', values: [] }])
            }}
          >
            + Add filter
          </Button>
        </div>
      </section>
    </div>
  )
}
