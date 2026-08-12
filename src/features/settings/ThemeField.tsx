'use client'

// The Theme section of Event Details (docs/parity/event-config.md ref 03).
//
// Section label, helper text and the `n / 1000` counter position (bottom right of the
// textarea) are all transcribed. The counter is live, and the field is hard capped at 1000
// rather than merely warning: ref 03 shows "18 / 1000" as a limit and `checkEventDetails`
// refuses a longer value, so letting the box accept 1200 characters would only produce a
// save that fails.
//
// The section heading IS the field's label, which is how ref 03 shows it, so the `Label`
// is visually hidden rather than repeated. Not omitted: the textarea still needs an
// accessible name.

import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { THEME_MAX_LENGTH } from '@/features/settings/draft'

export type ThemeFieldProps = {
  value: string
  error?: string
  onChange: (value: string) => void
}

export function ThemeField({ value, error, onChange }: ThemeFieldProps) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-sm font-semibold">Theme</h2>
      <p className="text-sm text-pretty text-muted-foreground">
        This helps improve search, recommendations, and how content is organized.
      </p>
      <Label htmlFor="event-theme" className="sr-only">
        Theme
      </Label>
      <div className="relative">
        <Textarea
          id="event-theme"
          rows={4}
          maxLength={THEME_MAX_LENGTH}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          className="pb-7"
        />
        {/* `tabular-nums`: this recounts on every keystroke and is pinned to the textarea's
            right edge, so proportional digits make the whole counter shuffle sideways as the
            count crosses 9, 99 and 999. Equal-width digits hold it still. */}
        <span className="pointer-events-none absolute right-2.5 bottom-2 text-xs text-muted-foreground tabular-nums">
          {value.length} / {THEME_MAX_LENGTH}
        </span>
      </div>
      {error === undefined ? null : (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
