'use client'

// The live combined counter for a cross-field character limit (ref 14: "Submitters see a
// live combined counter; speaker-field rules apply to each participant").
//
// Worded and coloured like the per-field counter in `FieldControl` (`n / 5,000 characters`,
// destructive once over), because it is the same fact about the same text and a second style
// for it would read as a different kind of warning. It names the questions it spans, since a
// budget shared between two boxes is otherwise a number with no subject.

import { combinedUsage } from '@/features/forms/cross-field-usage'
import type { FormAnswers } from '@/features/forms/logic'
import type { CrossFieldLimit, FormField } from '@/types/forms'
import { cn } from '@/utils/cn'

export type CombinedCounterProps = {
  limits: readonly CrossFieldLimit[]
  fields: readonly FormField[]
  answers: FormAnswers
}

export function CombinedCounter({ limits, fields, answers }: CombinedCounterProps) {
  const usages = combinedUsage(limits, fields, answers)
  if (usages.length === 0) return null

  return (
    <div className="flex flex-col gap-1">
      {usages.map((usage) => (
        <p
          key={usage.labels.join('|')}
          className={cn('text-xs', usage.over ? 'text-destructive' : 'text-muted-foreground')}
        >
          {`${usage.labels.join(' and ')}: ${usage.used.toLocaleString('en-US')} / ${usage.maxLen.toLocaleString('en-US')} characters combined`}
        </p>
      ))}
    </div>
  )
}
