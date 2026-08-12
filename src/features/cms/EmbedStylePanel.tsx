'use client'

// Ref 33's left pane: the `Style Options` section, expanded.
//
// Both of our screenshots have this section COLLAPSED. The panel below is transcribed off the
// changelog screenshot that has it open, linked from docs/parity/external-references.md
// ("Embed Style Options"). Four controls, in this order, with these exact labels:
//
//   1. `Website Color Theme`, a Select. Captured value `Light`.
//   2. `Primary Color`, a swatch plus a hex input. Captured value `#1b6ec2`.
//   3. `Date/Time Format`, a Select. Captured option `English (US): Fri, June 3, 2022 at 11:00 PM`.
//   4. `Extra CSS Code`, with an info icon, preceded by an info callout whose copy is VERBATIM, then
//      a code editor prefilled `.someClass {` / `  some-css-property: value;` / `}`.
//
// AUTHORED, and each for a stated reason:
//
//   - The swatch is a PREVIEW rather than a colour picker. The reference shows a swatch beside the
//     hex input and does not show it being operated; no shadcn colour picker is installed, and
//     hand-rolling one (or dropping in a raw `<input type="color">`) is the lint error the
//     ui-shadcn rule exists to produce. The hex field is the control, and it is validated.
//   - The prefilled code is a PLACEHOLDER, not a value. Prefilling the cell would store three lines
//     of nothing on every new embed, and `.someClass` is not CSS an organizer asked for.
//   - The code editor is a `Textarea` in a monospace font. A real editor means a new dependency, and
//     the deployed Worker has about 76 KiB of gzip headroom against Cloudflare's 3 MiB limit: the
//     last dependency added for one of these jobs failed the deploy at 3142 KiB.
//
// The hex validation is not cosmetic. `Primary Color` is emitted into the served page as a CSS
// custom property, so it is a stylesheet injection point that the CSS sanitizer never sees: it
// sanitizes a different column. @/features/cms/style-options owns the rule and is tested.

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { EmbedFieldLabel, EmbedSection } from '@/features/cms/EmbedSection'
import { isEmbedHex } from '@/features/cms/style-options'
import {
  EMBED_DATE_FORMAT_ITEMS,
  EMBED_THEME_ITEMS,
  type EmbedDateFormat,
  type EmbedTheme,
} from '@/types/cms'

/** Verbatim off the expanded panel's info callout. Do not improve the wording. */
const EXTRA_CSS_NOTICE =
  "Sessionboard doesn't validate or provide custom code support. This can break existing styles. Recommended for expert users or developers only."

/** Verbatim off the code editor in the same screenshot, all three lines. */
const EXTRA_CSS_PLACEHOLDER = '.someClass {\n  some-css-property: value;\n}'

export type EmbedStyleProps = {
  colorTheme: EmbedTheme
  primaryColor: string
  dateTimeFormat: EmbedDateFormat
  extraCss: string
  onColorThemeChange: (theme: EmbedTheme) => void
  onPrimaryColorChange: (color: string) => void
  onDateTimeFormatChange: (format: EmbedDateFormat) => void
  onExtraCssChange: (css: string) => void
}

export function EmbedStylePanel(props: EmbedStyleProps) {
  const colorValid = isEmbedHex(props.primaryColor)

  return (
    <EmbedSection title="Style Options">
      <div className="flex flex-col gap-1.5">
        <EmbedFieldLabel hint="Whether the embed renders on a light or a dark background.">
          Website Color Theme
        </EmbedFieldLabel>
        {/* `items` is required, or Base UI's closed trigger shows the raw stored value. */}
        <Select
          value={props.colorTheme}
          items={EMBED_THEME_ITEMS}
          onValueChange={(next: string | null) => {
            const match = EMBED_THEME_ITEMS.find((item) => item.value === next)
            if (match !== undefined) props.onColorThemeChange(match.value)
          }}
        >
          <SelectTrigger className="w-full" aria-label="Website Color Theme">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EMBED_THEME_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <EmbedFieldLabel htmlFor="embed-primary-color" hint="Six-digit hex, such as #1b6ec2.">
          Primary Color
        </EmbedFieldLabel>
        <div className="flex items-center gap-2">
          {/* The swatch. A preview of the typed value, so an invalid one shows the muted token
              rather than whatever the browser makes of a broken colour. */}
          <span
            aria-hidden
            className="size-8 shrink-0 rounded-lg border border-border bg-muted"
            style={colorValid ? { backgroundColor: props.primaryColor } : undefined}
          />
          <Input
            id="embed-primary-color"
            className="font-mono"
            value={props.primaryColor}
            aria-invalid={!colorValid}
            onChange={(event) => {
              props.onPrimaryColorChange(event.target.value)
            }}
          />
        </div>
        {colorValid ? null : (
          <p className="text-xs text-destructive">
            Primary Color must be a hex value such as #1b6ec2.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <EmbedFieldLabel hint="How dates and clock times are written in the rendered embed.">
          Date/Time Format
        </EmbedFieldLabel>
        <Select
          value={props.dateTimeFormat}
          items={EMBED_DATE_FORMAT_ITEMS}
          onValueChange={(next: string | null) => {
            const match = EMBED_DATE_FORMAT_ITEMS.find((item) => item.value === next)
            if (match !== undefined) props.onDateTimeFormatChange(match.value)
          }}
        >
          <SelectTrigger className="w-full" aria-label="Date/Time Format">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EMBED_DATE_FORMAT_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Alert>
          <AlertDescription>{EXTRA_CSS_NOTICE}</AlertDescription>
        </Alert>
        <EmbedFieldLabel
          htmlFor="embed-extra-css"
          hint="Applied to the rendered embed only. Rules that fetch a remote URL are removed."
        >
          Extra CSS Code
        </EmbedFieldLabel>
        <Textarea
          id="embed-extra-css"
          className="min-h-28 font-mono text-xs"
          placeholder={EXTRA_CSS_PLACEHOLDER}
          value={props.extraCss}
          onChange={(event) => {
            props.onExtraCssChange(event.target.value)
          }}
        />
      </div>
    </EmbedSection>
  )
}
