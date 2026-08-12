// The editor's draft, and the exact form it posts.
//
// Pure, and separate from the components, because the two functions here are the wire format between
// four client panels and one Server Action. `parseEmbedSave` reads what `embedDraftForm` writes, so a
// round-trip test over the pair is what stops a renamed field from becoming a control that saves
// nothing (tests/embed-save-payload.test.ts).
//
// One draft for all four sections, held in one place, because both PANES read it: the settings panel
// on the left edits it and the preview on the right has to reflect it. `view` is the exception and
// persists on change rather than on Save, since it is edited in the pane that shows the result.

import type {
  CmsEmbed,
  EmbedDateFormat,
  EmbedFieldOptions,
  EmbedFilters,
  EmbedFormat,
  EmbedTheme,
  EmbedView,
} from '@/types/cms'

export type EmbedDraft = {
  name: string
  enabled: boolean
  /** The OUTPUT format. Editable now that there are five of them (./format-options). */
  format: EmbedFormat
  view: EmbedView
  colorTheme: EmbedTheme
  primaryColor: string
  dateTimeFormat: EmbedDateFormat
  /** `''` rather than `undefined`, because it is bound to a textarea. */
  extraCss: string
  filters: EmbedFilters
  fieldOptions: EmbedFieldOptions
}

/** The stored embed as an editable draft. */
export function embedDraftFrom(embed: CmsEmbed): EmbedDraft {
  return {
    name: embed.name,
    enabled: embed.enabled,
    format: embed.format,
    view: embed.view,
    colorTheme: embed.colorTheme,
    primaryColor: embed.primaryColor,
    dateTimeFormat: embed.dateTimeFormat,
    // `extraCssRaw`, so the textarea shows what the organizer TYPED. Seeding it from the
    // sanitized copy meant opening the editor silently replaced their stylesheet with the served
    // rendering of it (comments gone, whitespace collapsed, refused declarations dropped), and
    // saving then made that the stored value. See `CmsEmbed.extraCssRaw`.
    extraCss: embed.extraCssRaw ?? '',
    filters: embed.filters,
    fieldOptions: embed.fieldOptions,
  }
}

/**
 * The draft as the `FormData` the save action parses.
 *
 * `enabled` is OMITTED when off, which is how an HTML form reports an unchecked box and what
 * `parseEmbedSave` reads. `extraCss` is always present, including empty, because an absent field
 * means "keep what is stored" and an organizer who emptied the editor means "clear it".
 */
export function embedDraftForm(draft: EmbedDraft): FormData {
  const form = new FormData()
  form.set('name', draft.name)
  form.set('format', draft.format)
  form.set('view', draft.view)
  if (draft.enabled) form.set('enabled', 'on')
  form.set('colorTheme', draft.colorTheme)
  form.set('primaryColor', draft.primaryColor)
  form.set('dateTimeFormat', draft.dateTimeFormat)
  form.set('extraCss', draft.extraCss)
  form.set('filters', JSON.stringify(draft.filters))
  form.set('fieldOptions', JSON.stringify(draft.fieldOptions))
  return form
}
