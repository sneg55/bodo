'use client'

// Ref 33's editor: back arrow, the embed's name as the panel title, and two panes.
//
// Transcribed: the back arrow button and the name beside it, a left settings panel holding FOUR
// collapsible sections (`Type` expanded, then `Style Options`, `Filters` with a count badge, and
// `Field Options`), a right preview panel, and a divider between them. Not transcribed: the divider
// is a plain rule rather than a DRAGGABLE handle. Ref 33 shows a handle, and a resizable split needs
// a `Resizable` primitive that is not installed; a fixed two-column grid that collapses to one
// column on a narrow screen is the same layout without a control that only appears to work.
//
// The draft lives here, in one place, because both panes read it: the left panel edits it and the
// preview on the right has to reflect it. `view` is an ordinary draft field like Name or Format now
// (EMB-15 fix): it is set in the settings panel's Type section and only takes effect on Save, same
// as everything else in that panel. It used to persist on change, straight from the preview's own
// toolbar, and that was the defect: a brand-new embed had no way to choose its view at all (the
// settings form never offered the field, and creation hard-coded `agenda`), and the one control
// that touched it wrote to the base immediately, out of step with the rest of the draft. The
// preview keeps its own View selector, but `previewView` below is local state that never leaves
// the browser: it overrides what URL the preview iframe loads (via the `sb-view` deep link) so the
// pane can demonstrate a view before it is saved, without claiming the embed serves it yet.
//
// ONE Save for the whole editor, below all four sections. Authored (ref 33 shows no save
// affordance), and one rather than four because a per-section write would let a filter change land
// while the style change submitted beside it failed, leaving four panels that agree with neither
// the base nor each other.

import { ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Button } from '@/components/ui/button'
import { saveEmbedAction } from '@/features/cms/actions'
import { type EmbedDraft, embedDraftForm, embedDraftFrom } from '@/features/cms/draft'
import { EmbedFieldsPanel } from '@/features/cms/EmbedFieldsPanel'
import { EmbedFiltersPanel } from '@/features/cms/EmbedFiltersPanel'
import { EmbedPreviewPanel } from '@/features/cms/EmbedPreviewPanel'
import { EmbedSettingsPanel } from '@/features/cms/EmbedSettingsPanel'
import { EmbedStylePanel } from '@/features/cms/EmbedStylePanel'
import { cardTypeForView, toggleEmbedField } from '@/features/cms/field-options'
import type { EmbedFilterGroup } from '@/features/cms/filter-options'
import {
  type EmbedFilterDimension,
  embedFilterValues,
  toggleEmbedFilter,
} from '@/features/cms/filters'
import { isEmbedHex } from '@/features/cms/style-options'
import type { CmsEmbed, EmbedCardType, EmbedView } from '@/types/cms'

export function EmbedEditor({
  eventId,
  embed,
  filterGroups,
  origin,
}: {
  eventId: string
  embed: CmsEmbed
  /** Built off this event by `readEmbedEditor` (@/features/cms/filter-options). */
  filterGroups: readonly EmbedFilterGroup[]
  /** `appUrl()`, resolved on the server: the client must not guess its own origin. */
  origin: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState<EmbedDraft>(() => embedDraftFrom(embed))

  const patch = (change: Partial<EmbedDraft>) => {
    setDraft((current) => ({ ...current, ...change }))
  }

  const save = () => {
    startTransition(async () => {
      const result = await saveEmbedAction(eventId, embed.id, embedDraftForm(draft))
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  // Local only, and never sent anywhere: this is what lets the preview toolbar's View selector
  // demonstrate a view without claiming the embed serves it yet. `undefined` means "no override",
  // so the preview starts on the PERSISTED view, same as `enabled` and `format` below it.
  const [previewView, setPreviewView] = useState<EmbedView | undefined>(undefined)

  const toggleFilter = (dimension: EmbedFilterDimension, value: string, on: boolean) => {
    patch({ filters: toggleEmbedFilter(draft.filters, dimension, value, on) })
  }

  const toggleField = (card: EmbedCardType, key: string, on: boolean) => {
    patch({ fieldOptions: toggleEmbedField(draft.fieldOptions, card, key, on) })
  }

  const isFieldSelected = (card: EmbedCardType, key: string) =>
    selectionFor(draft, card).includes(key)

  // A save the action would refuse is refused here too, so the button does not invite a round trip
  // that comes back as a toast. Both checks are the same rules `parseEmbedSave` applies.
  const blocked = draft.name.trim() === '' || !isEmbedHex(draft.primaryColor)

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex items-center gap-2">
        <ButtonLink
          href={`/admin/${eventId}/cms/embeds`}
          variant="ghost"
          size="icon"
          className="hit-area"
          aria-label="Back to Embeds"
        >
          <ArrowLeftIcon />
        </ButtonLink>
        <h1 className="min-w-0 truncate font-heading text-xl font-semibold">
          {draft.name.trim() === '' ? embed.name : draft.name}
        </h1>
      </header>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(18rem,22rem)_1fr] lg:divide-x lg:divide-border">
        <div className="flex min-w-0 flex-col gap-2 lg:pr-6">
          <EmbedSettingsPanel
            name={draft.name}
            enabled={draft.enabled}
            format={draft.format}
            view={draft.view}
            onNameChange={(name) => {
              patch({ name })
            }}
            onEnabledChange={(enabled) => {
              patch({ enabled })
            }}
            onFormatChange={(format) => {
              patch({ format })
            }}
            onViewChange={(view) => {
              patch({ view })
            }}
          />

          <EmbedStylePanel
            colorTheme={draft.colorTheme}
            primaryColor={draft.primaryColor}
            dateTimeFormat={draft.dateTimeFormat}
            extraCss={draft.extraCss}
            onColorThemeChange={(colorTheme) => {
              patch({ colorTheme })
            }}
            onPrimaryColorChange={(primaryColor) => {
              patch({ primaryColor })
            }}
            onDateTimeFormatChange={(dateTimeFormat) => {
              patch({ dateTimeFormat })
            }}
            onExtraCssChange={(extraCss) => {
              patch({ extraCss })
            }}
          />

          <EmbedFiltersPanel
            filters={draft.filters}
            groups={filterGroups}
            onToggle={toggleFilter}
          />

          <EmbedFieldsPanel
            fieldOptions={draft.fieldOptions}
            activeCard={cardTypeForView(draft.view)}
            onToggle={toggleField}
            isSelected={isFieldSelected}
          />

          <Button
            className="hit-area-y mt-2 self-start"
            disabled={pending || blocked}
            onClick={save}
          >
            Save
          </Button>
        </div>

        <div className="min-w-0">
          <EmbedPreviewPanel
            origin={origin}
            publicId={embed.publicId}
            name={draft.name}
            // The PERSISTED flag, not the draft: the iframe loads the real URL, and that URL is
            // served or not according to what is in the base. Showing a preview because a switch
            // has been flicked but not saved would promise a feed that is still 404ing.
            enabled={embed.enabled}
            // The PERSISTED view, overridden by the local-only `previewView` when the toolbar's
            // own selector has been touched. Never `draft.view`: that is the settings panel's
            // unsaved edit, and showing it here would make the preview agree with a Type the
            // embed does not serve yet. `onViewChange` only sets local state, so this selector
            // demonstrates a view (through the `sb-view` deep link on the previewed URL) without
            // writing anything.
            view={previewView ?? embed.view}
            // The PERSISTED format, beside the persisted `enabled` flag and for the same reason:
            // the URL in this pane is the one a visitor loads, and it answers in the format the
            // base holds. A snippet built from an unsaved selection would be a snippet for a
            // feed that is not being served yet.
            format={embed.format}
            onViewChange={setPreviewView}
          />
        </div>
      </div>
    </div>
  )
}

/** Exhaustive over the three cards, so `Record` is never indexed by a variable. */
function selectionFor(draft: EmbedDraft, card: EmbedCardType): readonly string[] {
  switch (card) {
    case 'agenda':
      return draft.fieldOptions.agenda
    case 'speaker':
      return draft.fieldOptions.speaker
    case 'session':
      return draft.fieldOptions.session
  }
}
