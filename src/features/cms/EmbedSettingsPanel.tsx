'use client'

// Ref 33's left pane: the Type section.
//
// Transcribed: the section is a Collapsible called "Type", expanded, containing a "Name" label
// with a red required asterisk and an info icon, a text input, an "Enabled" label with a toggle,
// a "Format" label with a red asterisk, and a Format card titled "Embed Styled HTML" plus two
// paragraphs of copy. The Styled HTML paragraphs are verbatim.
//
// THE "Locked" BADGE IS GONE AND THAT IS DELIBERATE. It was a faithful reading of a screenshot
// taken when Styled HTML was the only format, and it stayed correct for exactly as long as that
// was true here: a select with one option is not a control. There are five formats now, each with
// a serializer and a public URL behind it (./format-options), so the card carries a Select and
// the format is a saved column like any other. The reference's own "Create a new embed to use a
// different format" line is kept underneath, because it is still the better habit: a live embed's
// URL may be in somebody's HTML, and changing its format changes what that URL answers with.
//
// A "View" SELECT IS ADDED HERE, AND THAT IS THE FIX FOR EMB-15. `view` (Agenda, Session List,
// Schedule Itinerary, Speaker List, Speaker Gallery) is what a served embed actually renders, and
// until now the Type section that owns Name/Enabled/Format had no control for it at all: the only
// place it could be changed was the preview toolbar's View dropdown, which wrote it straight to
// the base through its own Server Action the instant it changed. A brand-new embed is created with
// `view: 'agenda'` and no way to choose otherwise, so an organizer who wanted a Session List embed
// had no path to one: the settings form never offered the field, and the preview selector changed
// it a beat later, out of step with the rest of the draft this section edits and the Save button
// below commits. `view` is now an ordinary field on `EmbedDraft`, edited here like Name or Format
// and posted by the same `saveEmbedAction` on the same Save. The preview toolbar keeps its own
// selector, but it now only previews: see EmbedPreviewPanel.tsx.
//
// The other three sections (`Style Options`, `Filters`, `Field Options`) are their own components
// and are composed beside this one by `EmbedEditor`. They used to be absent, on the grounds that
// both screenshots capture them collapsed; the changelog screenshot linked from
// docs/parity/external-references.md has Style Options open and the knowledge base describes the
// other two, so they are built.
//
// The Save button moved OUT of this section and down to the editor, below all four. It was authored
// in the first place (ref 33 shows no save affordance), and with four sections one button per
// section would mean four writes that can each half-land; `saveEmbedAction` commits the whole
// editor at once for the reason `cmsEmbedEditFields` sends every column on every save.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { EmbedFieldLabel, EmbedLabelText, EmbedSection } from '@/features/cms/EmbedSection'
import { EMBED_FORMAT_FOOTER, embedFormatDescription } from '@/features/cms/format-options'
import {
  EMBED_FORMAT_ITEMS,
  EMBED_VIEW_ITEMS,
  type EmbedFormat,
  type EmbedView,
  embedFormatLabel,
} from '@/types/cms'

export type EmbedSettingsProps = {
  name: string
  enabled: boolean
  format: EmbedFormat
  /** What the embed renders. The fix for EMB-15: see the header. */
  view: EmbedView
  onNameChange: (name: string) => void
  onEnabledChange: (enabled: boolean) => void
  onFormatChange: (format: EmbedFormat) => void
  onViewChange: (view: EmbedView) => void
}

export function EmbedSettingsPanel(props: EmbedSettingsProps) {
  const invalid = props.name.trim() === ''

  return (
    <EmbedSection title="Type" defaultOpen>
      <div className="flex flex-col gap-1.5">
        <EmbedFieldLabel
          htmlFor="embed-name"
          required
          hint="An internal label. It is not shown in the rendered embed."
        >
          Name
        </EmbedFieldLabel>
        <Input
          id="embed-name"
          value={props.name}
          aria-invalid={invalid}
          onChange={(event) => {
            props.onNameChange(event.target.value)
          }}
        />
        {invalid ? <p className="text-xs text-destructive">Name is required.</p> : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="embed-enabled">Enabled</Label>
        <Switch
          id="embed-enabled"
          checked={props.enabled}
          onCheckedChange={props.onEnabledChange}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <EmbedFieldLabel
          htmlFor="embed-view"
          required
          hint="What the embed renders: Agenda, Session List, Schedule Itinerary, Speaker List, or Speaker Gallery."
        >
          View
        </EmbedFieldLabel>
        <Select
          value={props.view}
          items={EMBED_VIEW_ITEMS}
          onValueChange={(next: string | null) => {
            const match = EMBED_VIEW_ITEMS.find((item) => item.value === next)
            if (match !== undefined) props.onViewChange(match.value)
          }}
        >
          <SelectTrigger id="embed-view" className="w-full" aria-label="View">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EMBED_VIEW_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <EmbedLabelText required>Format</EmbedLabelText>
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <CardTitle className="text-sm">Embed {embedFormatLabel(props.format)}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Select
              value={props.format}
              items={EMBED_FORMAT_ITEMS}
              onValueChange={(next: string | null) => {
                const match = EMBED_FORMAT_ITEMS.find((item) => item.value === next)
                if (match !== undefined) props.onFormatChange(match.value)
              }}
            >
              <SelectTrigger id="embed-format" aria-label="Format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMBED_FORMAT_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <p className="text-pretty">{embedFormatDescription(props.format)}</p>
              <p className="text-pretty">{EMBED_FORMAT_FOOTER}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </EmbedSection>
  )
}
