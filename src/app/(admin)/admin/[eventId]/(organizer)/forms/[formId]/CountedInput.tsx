'use client'

// A required text field with the character counter the builder shows on every one of them
// ("26/255"), and the inline hint some of them carry ("(15 char max)").
//
// Local to this surface rather than promoted to a primitive, for the same reason
// `LabeledInput` on the Abstracts sheet is: the five shared primitives are named in
// BUILD_SPEC 5.0 and this is not one of them.

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type CountedInputProps = {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  max: number
  required?: boolean
  hint?: string
  placeholder?: string
  /**
   * Off for the three "Page Heading" fields, which carry the inline "(15 char max)" hint
   * instead of a counter. That is how the reference renders them (refs 07, 08, 10): a
   * counter belongs on a 255-character field where the cap is far enough away to be worth
   * tracking.
   */
  counter?: boolean
}

export function CountedInput({
  id,
  label,
  value,
  onChange,
  max,
  required = false,
  hint,
  placeholder,
  counter = true,
}: CountedInputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>
          {label}
          {required ? <span className="text-destructive"> *</span> : null}
          {hint === undefined ? null : (
            <span className="ml-1 text-xs font-normal text-muted-foreground">{hint}</span>
          )}
        </Label>
        {counter ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {`${String(value.length)}/${String(max)}`}
          </span>
        ) : null}
      </div>
      <Input
        id={id}
        value={value}
        maxLength={max}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
