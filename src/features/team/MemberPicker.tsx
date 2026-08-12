'use client'

// A multi-select over the event's team members, with removable chips.
//
// `Popover` + `Command` + `Badge`, which is the mapping .claude/rules/ui-shadcn.md gives for
// "multi-select with removable chips (admin recipients, tags)". Built here in the team feature
// rather than in `src/components/ui/**` (generated, never hand-edited) and rather than as a
// sixth shared primitive, because its subject is the event's team: a form-builder step imports
// it from `@/features/team/MemberPicker`.
//
// THE VALUE IS A LIST OF EMAIL ADDRESSES, in and out, because that is what the columns it
// feeds actually store: `Forms.adminAlertOnNew` and `Forms.adminAlertOnUpdate` hold addresses
// and not `AdminUsers` record ids. So the team is the source of SUGGESTIONS and never the set
// of legal values, and an address that belongs to nobody on the team is a first-class case
// rather than an error: an organizer can alert an alias, or a colleague with no admin account,
// and a stored recipient whose membership was later revoked must not silently vanish from the
// control. Those render as a visibly different chip (dashed outline, `AtSignIcon`, and an
// "Not on the event team" line in the list) so the difference is shown rather than implied.
//
// Every rule is in ./recipients.ts and unit tested there (tests/team-recipients.test.ts). This
// file is the shell: it holds the popover open state and the typed query, and nothing else.

import { AtSignIcon, CheckIcon, PlusIcon, XIcon } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { isEmailLike, normalizeEmail } from '@/features/team/members'
import {
  addTypedRecipient,
  type RecipientOption,
  recipientChips,
  removeRecipient,
  toggleRecipient,
} from '@/features/team/recipients'

export type MemberPickerProps = {
  /** Put on the trigger, so a `Label htmlFor` outside can name the control. */
  id?: string
  /** The event's team as suggestions. Build it with `recipientOptions(members)`. */
  members: readonly RecipientOption[]
  /** Email addresses, exactly as the column stores them. */
  value: readonly string[]
  /** Normalized, de-duplicated email addresses. Store this. */
  onChange: (emails: readonly string[]) => void
  /** Shown on the trigger when nothing is selected. */
  placeholder?: string
  disabled?: boolean
  /** Reported when a typed address is refused. Defaults to nothing. */
  onError?: (message: string) => void
}

export function MemberPicker({
  id,
  members,
  value,
  onChange,
  placeholder = 'Select team members...',
  disabled = false,
  onError,
}: MemberPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const chips = recipientChips(value, members)
  const selected = new Set(chips.map((chip) => chip.email))
  const typed = normalizeEmail(query)
  // Offered only when it is a plausible address that is not already a suggestion: the
  // free-typed case the stored column legitimately holds.
  const offerTyped = isEmailLike(typed) && !members.some((option) => option.email === typed)

  function commitTyped(): void {
    const result = addTypedRecipient(value, query)
    if (!result.ok) {
      onError?.(result.message)
      return
    }
    onChange(result.value)
    setQuery('')
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              variant="outline"
              disabled={disabled}
              className="w-full justify-between font-normal"
            />
          }
        >
          <span className={chips.length === 0 ? 'text-muted-foreground' : undefined}>
            {chips.length === 0 ? placeholder : `${String(chips.length)} selected`}
          </span>
          {/* Trips the Button's trailing optical padding, so the icon sits closer to the
              edge than the leading label. See DataTableToolbar.tsx. */}
          <PlusIcon data-icon="inline-end" className="shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent className="w-(--anchor-width) min-w-72 p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Search team or type an email..."
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              {/* Only when there is also nothing to add: otherwise the row below is the answer. */}
              {offerTyped ? null : <CommandEmpty>No team members found.</CommandEmpty>}

              {members.map((option) => (
                <CommandItem
                  key={option.email}
                  value={`${option.name} ${option.email}`}
                  onSelect={() => {
                    onChange(toggleRecipient(value, option.email))
                  }}
                >
                  <CheckIcon
                    className={selected.has(option.email) ? 'size-4' : 'size-4 opacity-0'}
                  />
                  <span className="min-w-0 truncate">
                    {option.name === '' ? option.email : option.name}
                  </span>
                  {option.name === '' ? null : (
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {option.email}
                    </span>
                  )}
                </CommandItem>
              ))}

              {offerTyped ? (
                <CommandItem value={typed} onSelect={commitTyped}>
                  <AtSignIcon className="size-4" />
                  <span className="min-w-0 truncate">Add &quot;{typed}&quot;</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    Not on the event team
                  </span>
                </CommandItem>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {chips.length === 0 ? null : (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <Badge
              key={chip.email}
              // A member and a free-typed address are the same value to the column and a
              // different fact to the organizer, so they do not look alike.
              variant={chip.kind === 'member' ? 'secondary' : 'outline'}
              // `overflow-visible` is the enabler for the remove button's hit area below, not
              // a look: `badgeVariants` clips descendants, which would cut the 26px area back
              // to the chip's own box. The chip is `w-fit` and its only child background is
              // the ghost button's hover circle, inset from the corner arc, so nothing else
              // escapes. Matches the tag chip in crm/SpeakerTagEditor.tsx.
              className={
                chip.kind === 'member'
                  ? 'gap-1 overflow-visible pr-1'
                  : 'gap-1 overflow-visible border-dashed pr-1'
              }
            >
              {chip.kind === 'member' ? null : <AtSignIcon className="size-3" />}
              <span className="max-w-56 truncate">{chip.label}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${chip.email}`}
                disabled={disabled}
                // 26px and not 40: the chips wrap at `gap-1.5` under a `h-5` Badge, so the
                // vertical pitch to the same control one row down is 20 + 6 = 26, and the
                // popover trigger 8px above sits 18px from this centre. A 40px area would
                // cross both.
                className="size-4 hit-area-[26px]"
                onClick={() => {
                  onChange(removeRecipient(value, chip.email))
                }}
              >
                <XIcon className="size-3" />
              </Button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
