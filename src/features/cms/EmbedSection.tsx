'use client'

// One collapsible section in ref 33's left pane.
//
// Ref 33 captures four of them: `Type` expanded, then `Style Options`, `Filters` with a count badge
// reading `1`, and `Field Options`, all three collapsed with a chevron pointing down. So the section
// header is a Collapsible trigger carrying a title, an optional count, and a chevron that rotates.
// Built once here because four sections shipping four slightly different headers is how a panel
// stops looking like one panel.
//
// The count is rendered only when it is non-zero, which is what ref 33 shows: `Filters` carries a
// badge and the other two do not.

import { ChevronDownIcon, InfoIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/utils/cn'

export function EmbedSection({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string
  /** The applied-filter count. Omitted, or zero, renders no badge. */
  count?: number
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={<Button variant="ghost" className="hit-area-y w-full justify-start gap-2 px-2" />}
      >
        <span className="font-medium">{title}</span>
        {count === undefined || count === 0 ? null : <Badge variant="secondary">{count}</Badge>}
        <ChevronDownIcon
          className={cn('ml-auto shrink-0 transition-transform', open ? '' : '-rotate-90')}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4 px-2 pt-3 pb-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * A field label with the info icon several of ref 33's labels carry.
 *
 * A `Tooltip` and not a native `title`, which is a lint error and rightly so. The copy inside each
 * tooltip is ours: the reference shows the icon but not what it says.
 */
export function EmbedFieldLabel({
  htmlFor,
  children,
  hint,
  required = false,
}: {
  htmlFor?: string
  children: ReactNode
  hint?: string
  required?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5">
      <EmbedLabelText htmlFor={htmlFor} required={required}>
        {children}
      </EmbedLabelText>
      {hint === undefined ? null : <EmbedHint>{hint}</EmbedHint>}
    </div>
  )
}

/** A label, with ref 33's red required asterisk when the field carries one. */
export function EmbedLabelText({
  htmlFor,
  required,
  children,
}: {
  htmlFor?: string
  required: boolean
  children: ReactNode
}) {
  return (
    <Label htmlFor={htmlFor}>
      {children}
      {required ? <span className="text-destructive"> *</span> : null}
    </Label>
  )
}

/** The info icon ref 33 shows beside several labels, with our own copy behind it. */
export function EmbedHint({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      {/* 20px visible, and the target grows to the PITCH rather than to 40: the label beside it is
          6px away and carries an `htmlFor`, so a 40px area would take the last 4px of a label that
          focuses the field. 20 + 6 = 26 makes the two meet and never cross. */}
      <TooltipTrigger
        render={<Button variant="ghost" size="icon" className="hit-area-[26px] size-5" />}
      >
        <InfoIcon className="size-3.5 text-muted-foreground" />
        <span className="sr-only">More information</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{children}</TooltipContent>
    </Tooltip>
  )
}
