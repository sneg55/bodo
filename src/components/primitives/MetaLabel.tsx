// MetaLabel: the machine label.
//
// Mono, uppercase, wide tracking. It is the reference's most repeated signal, so
// it needed one home rather than the same three utilities copied at every call
// site. `rule` adds the hairline that runs from the label to the edge, which is
// how the sidebar separates its nav groups.
//
// The `meta` utility in globals.css is the same treatment for cases that cannot
// take an element, such as a className on a shadcn part.

import { cva } from 'class-variance-authority'
import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

export type MetaLabelProps = {
  children: ReactNode
  /** Trailing hairline, for section headings. */
  rule?: boolean
  /** Defaults to muted. `accent` is gold, for dates and codes. */
  tone?: 'muted' | 'accent' | 'foreground'
  className?: string
}

/** cva rather than a lookup: `security/detect-object-injection` fails the build on
 *  a computed index into a plain object, and the same rule already shapes
 *  StatusChipBadge. */
const metaLabelVariants = cva('meta', {
  variants: {
    tone: {
      muted: 'text-muted-foreground',
      accent: 'text-primary',
      foreground: 'text-foreground',
    },
  },
  defaultVariants: { tone: 'muted' },
})

export function MetaLabel({ children, rule = false, tone = 'muted', className }: MetaLabelProps) {
  const label = <span className={cn(metaLabelVariants({ tone }), className)}>{children}</span>

  if (!rule) return label

  return (
    <div className="flex items-center gap-2">
      {label}
      <span aria-hidden className="hairline" />
    </div>
  )
}
