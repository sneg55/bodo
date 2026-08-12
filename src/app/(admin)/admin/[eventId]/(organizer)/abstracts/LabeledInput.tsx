'use client'

// A Label plus an Input, which the Add Abstract drawer needs a dozen times.
//
// Local to this surface rather than promoted to a primitive: the five shared primitives
// are named in BUILD_SPEC 5.0 and this is not one of them, so adding a sixth would be a
// decision taken on the way past rather than on purpose.

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type LabeledInputProps = {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Passed through to `Input`, e.g. `datetime-local`. */
  type?: string
  required?: boolean
}

export function LabeledInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  type,
  required = false,
}: LabeledInputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
