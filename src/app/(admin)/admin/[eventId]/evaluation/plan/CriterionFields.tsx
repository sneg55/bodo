'use client'

// The two field groups a criterion row is built out of, split from `CriteriaEditor` for
// the file-size limit rather than for any conceptual reason: the editor owns the layout
// and the state, these own one input each.

import { PlusIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Criterion } from '@/types/domain'

/** A dropdown criterion's choices. The scoring range is derived from these values. */
export function OptionRows({
  criterion,
  onChange,
}: {
  criterion: Criterion
  onChange: (options: readonly { label: string; value: number }[]) => void
}) {
  const options = criterion.options ?? []

  return (
    <div className="flex flex-col gap-1.5 border-t pt-3">
      {/* This line used to say the span of the option values is what the aggregate normalises
          against, which was true and was the bug: it made Accept=1 / Maybe=2 / Reject=3 score
          Accept as the worst possible answer. A dropdown is now recorded and shown, not scored.
          See `CriterionKind` in @/types/review. */}
      <p className="text-xs text-muted-foreground">
        Each option carries a value for your records. A dropdown is not scored: its answer is shown
        on the review, and the weighted average is built from the numeric criteria.
      </p>
      {options.map((option, index) => (
        <div key={`${criterion.key}-option-${String(index)}`} className="flex items-center gap-2">
          <Input
            aria-label={`Option ${String(index + 1)} label`}
            value={option.label}
            placeholder="Strong"
            onChange={(event) =>
              onChange(
                options.map((item, at) =>
                  at === index ? { ...item, label: event.target.value } : item,
                ),
              )
            }
          />
          <Input
            aria-label={`Option ${String(index + 1)} score`}
            type="number"
            className="w-24"
            value={String(option.value)}
            onChange={(event) =>
              onChange(
                options.map((item, at) =>
                  at === index ? { ...item, value: Number(event.target.value) || 0 } : item,
                ),
              )
            }
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove option ${String(index + 1)}`}
            onClick={() => onChange(options.filter((_, at) => at !== index))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([...options, { label: '', value: (options.at(-1)?.value ?? 0) + 1 }])
          }
        >
          <PlusIcon />
          Add option
        </Button>
      </div>
    </div>
  )
}

export function NumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: number
  onChange: (next: number) => void
}) {
  return (
    <div className="w-24 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        value={String(value)}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
      />
    </div>
  )
}
