// The small pieces the speaker edit sheet is assembled from: one labelled text input, and
// the reading of an emptied field. Split out of SpeakerEditSheet.tsx, which crossed the line
// limit; neither holds state nor talks to an action, which is what makes it a clean seam.
//
// Splitting a display name into first and last is deliberately NOT here: `editable-speaker.ts`
// owns that, because the sheet is handed an `EditableSpeaker` whose names are already split.

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  const id = `speaker-${label.toLowerCase().replaceAll(/[^a-z]+/gu, '-')}`
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

/** An emptied field is absent on the row, matching what the record now holds. */
export function blank(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}
