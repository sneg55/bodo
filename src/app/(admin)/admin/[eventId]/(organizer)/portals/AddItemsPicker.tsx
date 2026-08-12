'use client'

// The `Add` control on every content card, and the `Add Selected` confirmation inside it.
// Both labels are the vendor's own, off the help centre pages transcribed in
// `docs/parity/external-references.md`, so neither is reworded here.
//
// `Popover` + `Command` + `Badge`, which is the mapping `.claude/rules/ui-shadcn.md` gives
// for a multi-select over a searchable list. `CommandDialog` was the other option and it is
// wrong for this: the picker belongs beside the card it adds to, and a centred modal over a
// page of four cards loses which one is being edited.
//
// WHAT "ADD" MEANS HERE, and the copy says it because an organizer cannot be expected to
// infer it: adding puts the record ON THE PORTAL, which is an exposure gate. It does not
// create the record and it does not assign it to anybody. The speakers who see it are the
// ones the record already applies to. Wording it as "add to the portal" rather than "assign"
// is the whole reason this control is not called Assign.
//
// The list offers only rows that are currently off, because a row already on the portal has
// nothing for Add to do to it; its switch is the control that takes it back off. An event
// whose every record is already on renders the empty line rather than an empty box.

import { CheckIcon, PlusIcon } from 'lucide-react'
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
import type { PortalContentRow } from '@/features/portal-config/content'

export type AddItemsPickerProps = {
  /** Singular, lowercase: `task`, `form`, `file request`, `page`. */
  noun: string
  /** The rows not currently on the portal. Already scoped to one kind by the card. */
  options: readonly PortalContentRow[]
  disabled?: boolean
  onAdd: (itemIds: readonly string[]) => void
}

export function AddItemsPicker({ noun, options, disabled = false, onAdd }: AddItemsPickerProps) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<readonly string[]>([])

  const chosen = new Set(selected)

  function toggle(itemId: string): void {
    setSelected(chosen.has(itemId) ? selected.filter((id) => id !== itemId) : [...selected, itemId])
  }

  function confirm(): void {
    onAdd(selected)
    // Cleared with the popover, so reopening it does not re-offer rows that are now on the
    // portal and no longer in `options`: a stale selection would then confirm nothing and
    // look like the button had failed.
    setSelected([])
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next: boolean) => {
        setOpen(next)
        if (!next) setSelected([])
      }}
    >
      <PopoverTrigger render={<Button variant="outline" size="sm" disabled={disabled} />}>
        <PlusIcon />
        Add
      </PopoverTrigger>

      <PopoverContent className="w-80 p-0" align="end">
        <Command>
          <CommandInput placeholder={`Search ${noun}s...`} />
          <CommandList>
            <CommandEmpty>{`Every ${noun} on this event is already on this portal.`}</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.itemId}
                value={`${option.title} ${option.itemId}`}
                onSelect={() => {
                  toggle(option.itemId)
                }}
              >
                <CheckIcon className={chosen.has(option.itemId) ? 'size-4' : 'size-4 opacity-0'} />
                <span className="min-w-0 truncate">
                  {option.title.trim() === '' ? `Untitled ${noun}` : option.title}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>

        <div className="flex items-center justify-between gap-2 border-t border-border p-2">
          <span className="text-xs text-muted-foreground">
            Adds to this portal. It assigns nothing.
          </span>
          <Button size="sm" disabled={selected.length === 0} onClick={confirm}>
            Add Selected
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
