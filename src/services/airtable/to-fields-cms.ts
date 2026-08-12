// App input to an Airtable field set, for CmsEmbeds.
//
// Inherits the rule to-fields.ts exists for: a link is an ARRAY even when it holds one id,
// and an ABSENT key leaves the old value in place. Two decisions follow from that here.
//
// The create sends `format` and `enabled` explicitly, including `enabled: false`. A new embed
// arrives DISABLED, which is our choice and not transcribed: ref 32's one embed is Enabled,
// but the alternative is that pressing "+ Add Embed" starts serving a feed at a URL the
// organizer has not looked at yet, and the toggle in the editor is one click away.
//
// The edit deliberately does NOT send the event link or `publicId`. An embed does not change
// events and its public URL is its identity: re-sending either on every save turns a
// mis-passed id into a silent re-parenting, or into a live embed on somebody else's website
// going dead, rather than into a failed write.
//
// `format` IS sent, and it did not used to be. The Locked badge in ref 33 was a reading of a
// vocabulary with one member: with `Styled HTML` the only option, a Format select would have been
// a control that could not be operated. There are five formats now, each with a serializer and a
// public URL behind it (@/features/cms/format-options), so the column is editable and travels
// with every other edited column for the reason below: an omitted key leaves the old value in
// place, which would make a format change silently do nothing.

import type { FieldSet } from '@/services/airtable/records'
import { COL } from '@/services/airtable/tables'
import { compact, link } from '@/services/airtable/to-fields'
import type { CmsEmbed, EmbedFieldOptions, EmbedFilters } from '@/types/cms'
import type { RecordId } from '@/types/domain'

export type CmsEmbedDraft = {
  eventId: RecordId
  name: string
  /** Minted by the caller (`nanoid`), never derived from the event or the name. */
  publicId: string
  format: CmsEmbed['format']
  view: CmsEmbed['view']
  enabled: boolean
  /**
   * The Style Options defaults, written out rather than left blank.
   *
   * The mapper defaults a blank cell to the same three values, so this changes nothing about what
   * the app reads. It changes what an organizer looking at the Airtable table sees: three filled
   * cells they can compare against the editor, rather than three empty ones that look unset.
   */
  colorTheme: CmsEmbed['colorTheme']
  primaryColor: string
  dateTimeFormat: CmsEmbed['dateTimeFormat']
  /**
   * The three sections a DUPLICATE carries over, absent on a fresh create.
   *
   * Optional rather than required for the reason `cmsEmbedFields` gives below: a new embed wants
   * these cells blank, and a copy wants them equal to the row it copied. `extraCss` is the RAW
   * text, never the sanitized rendering of it (see `CmsEmbed.extraCssRaw`).
   */
  extraCss?: string
  filters?: CmsEmbed['filters']
  fieldOptions?: CmsEmbed['fieldOptions']
}

export function cmsEmbedFields(draft: CmsEmbedDraft): FieldSet {
  return compact({
    [COL.name]: draft.name,
    [COL.event]: link(draft.eventId),
    [COL.publicId]: draft.publicId,
    [COL.format]: draft.format,
    [COL.view]: draft.view,
    [COL.enabled]: draft.enabled,
    [COL.colorTheme]: draft.colorTheme,
    [COL.primaryColor]: draft.primaryColor,
    [COL.dateTimeFormat]: draft.dateTimeFormat,
    // Filters and Field Options are left BLANK on a fresh create, not written as their defaults.
    // Both normalizers read a blank cell as "everything", which is what a new embed serves, and
    // writing the default field selection out would freeze today's inventory into the row: adding
    // a sixth field to a card later would leave every existing embed with it switched off.
    //
    // A DUPLICATE passes all three, because there the stored selection IS the thing being copied.
    // `compact` drops whichever are absent, so one function serves both.
    [COL.extraCss]: draft.extraCss,
    [COL.filtersJson]: draft.filters === undefined ? undefined : JSON.stringify(draft.filters),
    [COL.fieldOptionsJson]:
      draft.fieldOptions === undefined ? undefined : JSON.stringify(draft.fieldOptions),
  })
}

/** What the editor may change. Everything except the event link and the publicId. */
export type CmsEmbedEdit = {
  name: string
  format: CmsEmbed['format']
  view: CmsEmbed['view']
  enabled: boolean
  colorTheme: CmsEmbed['colorTheme']
  primaryColor: string
  dateTimeFormat: CmsEmbed['dateTimeFormat']
  /** Already validated by the caller. Absent clears the cell. */
  extraCss?: string
  filters: EmbedFilters
  fieldOptions: EmbedFieldOptions
}

/**
 * An edit to an existing row.
 *
 * EVERY key is always present, `enabled: false` and an empty `extraCss` included. Omitting a key
 * leaves the old value in place (to-fields.ts), so a section that saves only what it changed would
 * make "unchanged" the reading of a save that cleared something. `enabled` is the flag the public
 * route refuses on and `extraCss` is a stylesheet on a stranger's page: neither may survive a save
 * that turned it off.
 *
 * The two blobs are stringified here and nowhere else, so the shape that goes into the cell is the
 * shape `normalizeEmbedFilters` and `normalizeEmbedFieldOptions` read back out.
 */
export function cmsEmbedEditFields(edit: CmsEmbedEdit): FieldSet {
  return {
    [COL.name]: edit.name,
    [COL.format]: edit.format,
    [COL.view]: edit.view,
    [COL.enabled]: edit.enabled,
    [COL.colorTheme]: edit.colorTheme,
    [COL.primaryColor]: edit.primaryColor,
    [COL.dateTimeFormat]: edit.dateTimeFormat,
    // Only when the edit CARRIES it. Writing `''` for an absent value is what let an unrelated
    // one-field write (a toggle of Enabled from the list page) clear an organizer's stylesheet:
    // Airtable leaves a column alone when the field set omits it, which is exactly the behaviour
    // an omitted `extraCss` should have. A PRESENT empty string still clears the cell, which is
    // how the editor's own "I emptied the textarea" reaches storage. Found by Codex review.
    ...(edit.extraCss === undefined ? {} : { [COL.extraCss]: edit.extraCss }),
    [COL.filtersJson]: JSON.stringify(edit.filters),
    [COL.fieldOptionsJson]: JSON.stringify(edit.fieldOptions),
  }
}
