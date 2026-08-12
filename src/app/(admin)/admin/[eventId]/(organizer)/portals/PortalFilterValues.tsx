'use client'

// The right-hand side of one filter rule: what the chosen field is being compared against.
//
// Split out of `PortalFilterEditor` when that file crossed the size budget. It is a clean
// seam rather than a convenient one: this component owns the question "how is a value for
// THIS field entered", which is the one part of the editor that changes per field.
//
// The split is not cosmetic. `track` and `tag` carry RECORD IDS (types/portals.ts), because
// a name silently stops matching the moment an organizer renames a track, so those two are
// pickers over the event's own records and the chips are how an organizer sees WHICH track
// a rule holds: the stored value is an id, which is unreadable. `role` is a fixed
// vocabulary. Everything else is free text, matched case- and whitespace-insensitively by
// `matchesText`, so it is one comma-separated field: the values are a set the rule matches
// ANY of, and "Track is Platform or Security" is one rule rather than two.

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PORTAL_CONTACT_TYPES, type PortalFilterRule } from '@/types/portals'

import { CONTACT_TYPE_LABELS, labelOf } from './portal-filter-labels'

/** One pickable record, already reduced to what the chips need. */
export type FilterOption = { id: string; name: string }

export function RuleValues({
  rule,
  tracks,
  tags,
  disabled,
  onValuesChange,
}: {
  rule: PortalFilterRule
  tracks: readonly FilterOption[]
  tags: readonly FilterOption[]
  disabled: boolean
  onValuesChange: (values: readonly string[]) => void
}) {
  const options = optionsFor(rule, tracks, tags)

  if (options === undefined) {
    return (
      <Input
        className="min-w-48 flex-1"
        disabled={disabled}
        placeholder="Value, or several separated by commas"
        value={rule.values.join(', ')}
        onChange={(event) => {
          onValuesChange(
            event.target.value
              .split(',')
              .map((value) => value.trim())
              .filter((value) => value !== ''),
          )
        }}
      />
    )
  }

  const chosen = new Set(rule.values)
  return (
    <span className="flex min-w-48 flex-1 flex-wrap gap-1">
      {options.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          Nothing to pick. Add one in Event Settings first.
        </span>
      ) : (
        options.map((option) => (
          <Button
            key={option.id}
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="h-auto p-0"
            onClick={() => {
              onValuesChange(
                chosen.has(option.id)
                  ? rule.values.filter((value) => value !== option.id)
                  : [...rule.values, option.id],
              )
            }}
          >
            <Badge variant={chosen.has(option.id) ? 'default' : 'outline'}>{option.name}</Badge>
          </Button>
        ))
      )}
    </span>
  )
}

/** The pickable set for this rule's field, or `undefined` when the field is free text. */
function optionsFor(
  rule: PortalFilterRule,
  tracks: readonly FilterOption[],
  tags: readonly FilterOption[],
): readonly FilterOption[] | undefined {
  if (rule.field === 'track') return tracks
  if (rule.field === 'tag') return tags
  if (rule.field === 'role') {
    return PORTAL_CONTACT_TYPES.map((value) => ({
      id: value,
      name: labelOf(CONTACT_TYPE_LABELS, value),
    }))
  }
  return undefined
}
