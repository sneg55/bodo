'use client'

// The toolbar row above the table: search, row density, Saved Views, then the Columns /
// Sort / Filter buttons, then whatever else the surface adds. Those three are not separate
// features: each one deep-links to the matching tab of the one Preferences drawer, which is
// what the matching labels and icons in the audit imply.
//
// The ORDER is transcribed and it used to be wrong. Refs 19 and the Agenda row both run
// search, density, Saved Views, Columns, Sort, Filter, and only then the surface's own
// controls (Drafts, Options, + Add). This file had Columns / Sort / Filter pinned right with
// `ml-auto`, which put them AFTER everything a surface passed in and moved "+ Add Session"
// off the right edge. Fixing it needed two slots rather than one, because the surface
// contributes controls on both sides of the three preference buttons: `views` goes before
// them and `extra` after, and the right-hand group is the one that pushes right.

import {
  ArrowUpDownIcon,
  Columns3Icon,
  FunnelIcon,
  Rows3Icon,
  SearchIcon,
  XIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import {
  DATA_TABLE_DENSITY_LABELS,
  type DataTableDensity,
  type PreferenceTab,
} from '@/components/primitives/data-table-types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const DENSITY_LABEL = 'Row density'

export type DataTableToolbarProps = {
  search: string
  onSearchChange: (value: string) => void
  searchPlaceholder: string
  density: DataTableDensity
  onDensityChange: (density: DataTableDensity) => void
  onOpenPreferences: (tab: PreferenceTab) => void
  /**
   * Saved Views, which sits between the density control and Columns in the reference.
   * Its own slot rather than part of `extra` because it is the one surface-supplied control
   * the reference places BEFORE the three preference buttons.
   */
  views?: ReactNode
  /** Everything the surface adds after Filter: Drafts, Options, + Add, bulk actions. */
  extra?: ReactNode
}

export function DataTableToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  density,
  onDensityChange,
  onOpenPreferences,
  views,
  extra,
}: DataTableToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <InputGroup className="max-w-xs">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          value={search}
          placeholder={searchPlaceholder}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        {/* An explicit way back to the unfiltered list. Selecting the text and deleting it
            already clears the query, and that is exactly the problem: the only evidence a
            search is still applied is a row count, so an organizer who thinks they have
            cleared it is shown a narrowed table with no visible filter on it. Rendered only
            when there is something to clear, so it never sits there doing nothing. */}
        {search === '' ? null : (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              variant="ghost"
              aria-label="Clear search"
              onClick={() => onSearchChange('')}
            >
              <XIcon />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="icon">
                    <Rows3Icon />
                    <span className="sr-only">{DENSITY_LABEL}</span>
                  </Button>
                }
              />
            }
          />
          <TooltipContent>{DENSITY_LABEL}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={density}
            onValueChange={(next: DataTableDensity) => onDensityChange(next)}
          >
            {/* Inside the radio group, not above it. This is Base UI's
                `Menu.GroupLabel`, which throws `MenuGroupContext is missing` when it
                renders with no Group or RadioGroup ancestor, and the radio group is
                exactly what it labels. As a sibling it crashed the density menu on
                every data table in the app. */}
            <DropdownMenuLabel>{DENSITY_LABEL}</DropdownMenuLabel>
            {DATA_TABLE_DENSITY_LABELS.map((entry) => (
              <DropdownMenuRadioItem key={entry.density} value={entry.density}>
                {entry.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {views}

      {/* `data-icon="inline-start"` is what trips the Button's own optical padding
          (`has-data-[icon=inline-start]:pl-2` against a base `px-2.5`), so the leading
          icon sits 2px closer to the edge than the trailing text and the label reads
          centred. Without it these three were padded geometrically and the icon looked
          pushed in. */}
      <Button variant="outline" onClick={() => onOpenPreferences('columns')}>
        <Columns3Icon data-icon="inline-start" />
        Columns
      </Button>
      <Button variant="outline" onClick={() => onOpenPreferences('sort')}>
        <ArrowUpDownIcon data-icon="inline-start" />
        Sort
      </Button>
      <Button variant="outline" onClick={() => onOpenPreferences('filter')}>
        <FunnelIcon data-icon="inline-start" />
        Filter
      </Button>

      {extra === undefined ? null : (
        <div className="ml-auto flex flex-wrap items-center gap-1.5">{extra}</div>
      )}
    </div>
  )
}
