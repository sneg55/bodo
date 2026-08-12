'use client'

// The inline lifecycle editor: a StatusChip that opens a Popover whose option
// list is a Command. Split out of StatusChip.tsx so the chip itself stays a server
// component. A status chip appears in every row of every list, and making all of
// them client components to serve the handful that are editable is exactly the
// payload mistake BUILD_SPEC section 6.3 is about.

import { XIcon } from 'lucide-react'
import { useState } from 'react'
import { StatusChip, submissionStatusLabel } from '@/components/primitives/StatusChipBadge'
import { Button } from '@/components/ui/button'
import { Command, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { SUBMISSION_TRANSITIONS, type SubmissionStatus } from '@/constants/status'

/**
 * The order the popover lists statuses in, read off the product. Draft and
 * Withdrawn are deliberately absent: the audit shows them as tabs only, because
 * a draft is unsubmitted and a withdrawal is the speaker's decision, not the
 * admin's. Either still appears if the lifecycle makes it a legal move from the
 * current status, appended after these.
 */
const EDITOR_STATUS_ORDER: readonly SubmissionStatus[] = [
  'accepted',
  'accept_queue',
  'pending',
  'decline_queue',
  'declined',
]

/** Map, not record indexing, so a dynamic status key stays lint-clean. */
const TRANSITIONS: ReadonlyMap<SubmissionStatus, readonly SubmissionStatus[]> = new Map(
  Object.entries(SUBMISSION_TRANSITIONS).map(([key, next]) => [key as SubmissionStatus, next]),
)

function editorOptions(current: SubmissionStatus): readonly {
  status: SubmissionStatus
  legal: boolean
}[] {
  const legal = new Set<SubmissionStatus>([current, ...(TRANSITIONS.get(current) ?? [])])
  const extras = [...legal].filter((status) => !EDITOR_STATUS_ORDER.includes(status))

  return [...EDITOR_STATUS_ORDER, ...extras].map((status) => ({
    status,
    // Shown but disabled rather than hidden: the five statuses are a fixed strip
    // in the product, and a list whose length changes per row is harder to read
    // than one where the unreachable moves are visibly unreachable.
    legal: legal.has(status),
  }))
}

export type StatusChipEditorProps = {
  status: SubmissionStatus
  /** `null` is the popover's Clear control. */
  onChange: (next: SubmissionStatus | null) => void
  disabled?: boolean
}

export function StatusChipEditor({ status, onChange, disabled = false }: StatusChipEditorProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<SubmissionStatus | null>(status)
  const options = editorOptions(status)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setDraft(status)
        }
      }}
    >
      {/*
        `inline-flex` is an alignment fix, not a layout preference. A `<button>` is
        `inline-block`, so the `inline-flex` chip inside it sat on the button's own text
        baseline and the button's box ran a few pixels taller than the chip: the
        `rounded-4xl` focus ring was drawn around that taller box and read as sitting low
        against the chip it was supposed to trace. Making the trigger a flex container
        collapses its box onto the chip's, so ring and chip are the same pill.
      */}
      <PopoverTrigger
        disabled={disabled}
        className="inline-flex rounded-4xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <StatusChip status={status} />
        <span className="sr-only">Edit status</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-2 p-0">
        <div className="flex items-center justify-between px-2.5 pt-2.5">
          <span className="text-sm font-medium">Status</span>
          {/*
            `size="xs"` is 24px tall and already wider than 40px, so only the height is
            short of the 40px minimum. The pseudo-element takes it there vertically and
            is deliberately `inset-x-0`: the row's other occupant is the plain `Status`
            label, and there is nothing to gain from reaching over text that cannot be
            clicked. Above it is the popover's own 10px of padding; below it is the 8px
            gap and then the Command's 4px of padding, so 8px in each direction lands in
            empty space rather than on the first option row.
          */}
          <Button variant="ghost" size="xs" className="hit-area-y" onClick={() => setDraft(null)}>
            <XIcon />
            Clear
          </Button>
        </div>

        <Command>
          <CommandList>
            {options.map((option) => (
              // `data-checked` is the shadcn idiom and it is what draws the mark: the
              // `CommandItem` wrapper renders a trailing `CheckIcon` whose only visible
              // state is `group-data-[checked=true]/command-item:opacity-100`
              // (components/ui/command.tsx). So the tick on the current value comes from
              // this attribute and nothing else, and it must not be re-implemented here.
              //
              // What the attribute did NOT carry is the row HIGHLIGHT ref 20 describes
              // ("Pending, row highlighted with a checkmark on the right"): the only
              // background in `CommandItem` is `data-selected`, which cmdk owns and moves
              // with the pointer and the arrow keys. So the checked row gets its own
              // background here, on the composed component rather than in the generated
              // primitive. `data-checked:` and not `data-[checked=true]:`, because the
              // former is the variant shadcn's own layer registers (it is what
              // checkbox.tsx and radio-group.tsx use) and it matches any `data-checked`
              // that is not literally `"false"`.
              <CommandItem
                key={option.status}
                value={submissionStatusLabel(option.status)}
                disabled={!option.legal}
                data-checked={option.status === draft ? 'true' : undefined}
                className="data-checked:bg-muted"
                onSelect={() => setDraft(option.status)}
              >
                <StatusChip status={option.status} />
              </CommandItem>
            ))}
          </CommandList>
        </Command>

        <Separator />

        <div className="flex min-h-8 items-center gap-1.5 px-2.5">
          {draft === null ? (
            <span className="text-xs text-muted-foreground">No status</span>
          ) : (
            <StatusChip status={draft} />
          )}
          {draft === null ? null : (
            // 24px visible, 40px clickable, and the 8px it gains on every side is
            // checked against what it reaches rather than assumed: the row is `min-h-8`
            // and the popover stacks with `gap-2`, so 8px up and down stops 4px inside
            // those gaps and touches neither the option list above nor Cancel below.
            // Sideways it passes over the preview chip, which is a Badge and not a
            // control, so no two hit areas overlap.
            <Button
              variant="ghost"
              size="icon-xs"
              className="hit-area"
              onClick={() => setDraft(null)}
            >
              <XIcon />
              <span className="sr-only">Remove {submissionStatusLabel(draft)}</span>
            </Button>
          )}
        </div>

        <div className="flex justify-end gap-1.5 px-2.5 pb-2.5">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setOpen(false)
              onChange(draft)
            }}
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
