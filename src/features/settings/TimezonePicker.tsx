'use client'

// The Timezone control: a searchable list of real IANA zones.
//
// `Popover` + `Command`, which is the mapping in .claude/rules/ui-shadcn.md for a
// searchable single select, and not a plain `Select`: the runtime knows several hundred
// zones and ref 03 shows a truncated GMT-offset label, so scanning needs a filter.
//
// The reason this is a PICKER rather than the text field the column implies: an
// unrecognised `Events.timezone` used to throw `RangeError` out of `Intl` on every agenda
// surface, the .ics builder and the public agenda page. `src/features/agenda/time.ts` now
// falls back to UTC, but Settings is where the bad value gets entered, so the fix belongs
// here too. Options are built from `Intl` itself (timezones.ts), so nothing selectable can
// be a zone the runtime rejects.

import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { TimezoneOption } from '@/features/settings/timezones'
import { cn } from '@/utils/cn'

export type TimezonePickerProps = {
  id: string
  value: string
  options: readonly TimezoneOption[]
  onChange: (zone: string) => void
}

export function TimezonePicker({ id, value, options, onChange }: TimezonePickerProps) {
  const [open, setOpen] = useState(false)
  // Falls back to the stored value rather than to a placeholder: a zone the option list
  // does not carry is exactly the case an organizer needs to SEE in order to fix it.
  const label = options.find((option) => option.value === value)?.label ?? value

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            // `plain-label`: the trigger shows a zone name, not a command. The
            // machine-label treatment rendered it AMERICA/LOS_ANGELES and spent
            // enough width to truncate the GMT offset ref 03 shows.
            className="plain-label w-full justify-between font-normal"
            aria-label="Timezone"
          />
        }
      >
        <span className="truncate">{label === '' ? 'Select a timezone' : label}</span>
        <ChevronsUpDownIcon className="shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search timezones..." />
          <CommandList>
            <CommandEmpty>No timezones found.</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                value={option.label}
                onSelect={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                <CheckIcon
                  className={cn('size-4', option.value === value ? 'opacity-100' : 'opacity-0')}
                />
                <span className="truncate">{option.label}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
