'use client'

// One criterion, rendered as whatever kind it is: a slider, a dropdown, or a text box.
//
// The three kinds are what ABS-03 asks for and what the data model only gained with the
// plan editor. Before that a rubric could only be a list of min/max sliders, so a
// committee that wanted "Accept / Revise / Reject" as a dropdown had to encode it as a
// 1-3 slider and remember what the numbers meant.
//
// A dropdown stores the NUMBER its option carries, not the label, which is what lets it
// aggregate exactly like a slider: `scoring.ts` normalises it over the range the options
// span and never has to know a select from a numeric. A text criterion stores prose in
// `notes` and is excluded from the aggregate entirely.

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { criterionSelectItems } from '@/features/review/criterion-answer'
import type { Criterion } from '@/types/domain'

export function CriterionControl({
  criterion,
  score,
  note,
  onScore,
  onNote,
}: {
  criterion: Criterion
  /** Absent when the reviewer has not answered. Never coerced to zero: see `scoring.ts`. */
  score: number | undefined
  note: string
  onScore: (next: number) => void
  onNote: (next: string) => void
}) {
  if (criterion.kind === 'text') {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{criterion.label}</span>
        <Textarea
          rows={3}
          value={note}
          aria-label={criterion.label}
          placeholder="Enter text here..."
          onChange={(event) => onNote(event.target.value)}
        />
      </div>
    )
  }

  if (criterion.kind === 'select') {
    const options = criterion.options ?? []
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{criterion.label}</span>
        <Select
          // The value stored is the SCORE, so without this a reviewer who picked
          // "Strong accept" saw `5` on the closed trigger. Built by
          // `criterion-answer.ts` rather than inline, because the organizer's Reviews
          // block resolves the same score to the same label through that module and the
          // two readings must not be able to drift.
          items={criterionSelectItems(criterion)}
          value={score === undefined ? '' : String(score)}
          onValueChange={(next: string | null) => {
            if (next === null || next === '') return
            onScore(Number(next))
          }}
        >
          <SelectTrigger aria-label={criterion.label}>
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              // Keyed and valued by the SCORE, because that is what is stored. Two
              // options sharing a value would be indistinguishable once saved, which
              // the plan editor is where an organizer would notice.
              <SelectItem key={option.value} value={String(option.value)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  const value = score ?? criterion.min
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{criterion.label}</span>
        <span className="text-sm tabular-nums text-muted-foreground">
          {score === undefined ? '-' : value} / {criterion.max}
        </span>
      </div>
      {/* An ARRAY of one, and it has to be: `components/ui/slider.tsx` decides how many
          thumbs to render from `Array.isArray(value)`, so a plain number fell through to
          its `[min, max]` default and rendered TWO. Base UI's Root still held one value,
          so a press on the track resolved to the closest thumb, found the phantom index 1
          sitting on top of the real one, and `getFingerState` returned null for an index
          past the end of `values`. That is why clicking did nothing while dragging the
          thumb itself worked. Fixed here rather than in the generated wrapper: this is its
          only call site, and `ui/**` is not ours to edit. */}
      <Slider
        value={[value]}
        min={criterion.min}
        max={criterion.max}
        step={1}
        aria-label={criterion.label}
        onValueChange={(next) => {
          onScore(typeof next === 'number' ? next : (next[0] ?? 0))
        }}
      />
    </div>
  )
}
