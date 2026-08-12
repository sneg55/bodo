'use client'

// Ref 33's left pane: the `Filters` section, with the applied-filter count badge it shows reading
// `1`.
//
// TRANSCRIBED: the section exists, it is collapsible, and its header carries a count. The dimensions
// come from Sessionboard's knowledge base via docs/parity/external-references.md: the session list is
// "filterable by format, language, tag, track, location", and the same page says an organizer can
// "apply filters such as specific tracks or statuses".
//
// AUTHORED: the control shape. No source shows the section open, so this is a checkbox list per
// dimension, which is what a set of independently selectable values is. The group labels are ours.
//
// NO STATUS GROUP, and that is a decision with evidence rather than an omission.
// @/features/cms/filters carries it: every row an embed can serve has already passed
// `publicAgendaRows`, and `ACCEPTED_STATUSES` is `['accepted']`, so a status checkbox could only
// narrow nothing or publish a session an organizer has not accepted.
//
// The choices are built off the EVENT, not off a vocabulary in this file
// (@/features/cms/filter-options). An empty group is rendered with a line saying so rather than
// hidden, so an event with no tags yet reads as "no tags defined" and not as "no tag filter exists".

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { EmbedSection } from '@/features/cms/EmbedSection'
import type { EmbedFilterChoice, EmbedFilterGroup } from '@/features/cms/filter-options'
import {
  type EmbedFilterDimension,
  embedFilterCount,
  embedFilterValues,
} from '@/features/cms/filters'
import { isEmbedHex } from '@/features/cms/style-options'
import type { EmbedFilters } from '@/types/cms'

export type EmbedFiltersProps = {
  filters: EmbedFilters
  groups: readonly EmbedFilterGroup[]
  onToggle: (dimension: EmbedFilterDimension, value: string, on: boolean) => void
}

export function EmbedFiltersPanel(props: EmbedFiltersProps) {
  return (
    <EmbedSection title="Filters" count={embedFilterCount(props.filters)}>
      <p className="text-pretty text-xs text-muted-foreground">
        Nothing selected serves every published session. Selecting values inside one group widens
        the feed; selecting across groups narrows it.
      </p>
      {props.groups.map((group) => (
        <fieldset key={group.dimension} className="flex flex-col gap-2">
          <legend className="pb-1 text-sm font-medium">{group.label}</legend>
          {group.choices.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No {group.label.toLowerCase()} values on this event yet.
            </p>
          ) : (
            group.choices.map((choice) => (
              <FilterChoice
                key={choice.value}
                choice={choice}
                dimension={group.dimension}
                checked={embedFilterValues(props.filters, group.dimension).includes(choice.value)}
                onToggle={props.onToggle}
              />
            ))
          )}
        </fieldset>
      ))}
    </EmbedSection>
  )
}

function FilterChoice({
  choice,
  dimension,
  checked,
  onToggle,
}: {
  choice: EmbedFilterChoice
  dimension: EmbedFilterDimension
  checked: boolean
  onToggle: (dimension: EmbedFilterDimension, value: string, on: boolean) => void
}) {
  const id = `embed-filter-${dimension}-${choice.value}`

  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(next: boolean) => {
          onToggle(dimension, choice.value, next)
        }}
      />
      {/* Tracks and tags carry their own colour, per the reference's Track and Tag objects. Rooms do
          not, and neither does a format or a language. The value is validated before it reaches an
          inline style, because `Tracks.color` is a free-text Airtable column. */}
      {choice.color !== undefined && isEmbedHex(choice.color) ? (
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: choice.color }}
        />
      ) : null}
      <Label htmlFor={id} className="min-w-0 truncate text-sm font-normal">
        {choice.label}
      </Label>
    </div>
  )
}
