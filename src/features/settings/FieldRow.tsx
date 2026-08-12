'use client'

// One labelled control on the Event Details form.
//
// Ref 03 puts a red asterisk on the four required fields and an info icon next to almost
// every label, so both are structural here rather than per-field decoration.
//
// AUTHORED COPY, flagged as such: the parity audit lists "contents of every info-icon
// tooltip" as its first ambiguity, because the screenshots show the icons and not what
// they say. The strings in `tooltips.ts` are written to be useful and to be obviously
// replaceable when the real wording turns up.

import { InfoIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export type FieldRowProps = {
  /** Matches the control's `id`, so clicking the label focuses it. */
  htmlFor: string
  label: string
  required?: boolean
  hint?: string
  /** The validation message for this field, when the last save attempt refused it. */
  error?: string
  children: ReactNode
  className?: string
}

export function FieldRow({
  htmlFor,
  label,
  required = false,
  hint,
  error,
  children,
  className,
}: FieldRowProps) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <Label htmlFor={htmlFor}>
          {label}
          {required ? (
            <span aria-hidden className="text-destructive">
              *
            </span>
          ) : null}
        </Label>
        {hint === undefined ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  tabIndex={0}
                  aria-label={`About ${label}`}
                  // 26px, not 40: the Label sits 6px to the left of a 14px icon, so half a
                  // hit area can reach 7 + 6 = 13px before it covers the label's click
                  // target. The Input below is 16px from the icon's centre and caps it at
                  // the same order.
                  className="hit-area-[26px] inline-flex text-muted-foreground"
                />
              }
            >
              <InfoIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>{hint}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {children}
      {error === undefined ? null : (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
