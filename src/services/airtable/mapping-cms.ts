// The CmsEmbeds mapper. One table, twelve columns.
//
// Three decisions worth their comments, and the first two are about what a blank cell means.
//
// `enabled` is a checkbox, and an Airtable checkbox reads as absent when it is off, so an
// unchecked box and a never-touched box are the same value on the wire. They mean the same
// thing here on purpose: not served. Defaulting the other way would publish a feed the
// moment its row was created, including a row an organizer made in Airtable directly to see
// what the table looked like.
//
// `format` and `view` are selects and both get a DEFAULT rather than throwing. `format` has
// one legal value, so a blank one can only be a row created outside the app, and refusing to
// map it would take the whole list down over a cell that has exactly one possible reading.
// `view` defaults to `agenda`, which is the view ref 33 captures selected, and it is the safe
// direction: every view renders the same event's public data, so guessing wrong shows the
// wrong LAYOUT and never the wrong records. The same reasoning covers all six Style Options,
// Filters and Field Options columns: every one of them falls back rather than throwing,
// because this row is read on a page a stranger loads and a 500 there is a broken integration
// on the conference's own website.
//
// `publicId` is required, and that one does throw. An embed with no public id has no URL, so
// it cannot be served, cannot be previewed, and would sit in the list looking healthy.
//
// THE THIRD DECISION IS THE SECURITY ONE. `extraCss` is sanitized HERE, at the read boundary,
// exactly as mapping-forms.ts sanitizes every HTML column and for the same three reasons: an
// event admin is a customer rather than the operator, this Airtable cell is writable directly
// so a guard at the write boundary guards nothing, and sanitizing at the render sink would put
// the sanitizer on a public page's render path and leave the raw blob in the RSC payload.
// @/features/cms/safe-css carries the argument in full. `primaryColor` gets the same treatment
// through `embedPrimaryColor`, because it is emitted into the page as a CSS custom property and
// the CSS sanitizer never sees that column.

import { normalizeEmbedFieldOptions } from '@/features/cms/field-options'
import { normalizeEmbedFilters } from '@/features/cms/filters'
import { safeStoredEmbedCss } from '@/features/cms/safe-css'
import { embedColorTheme, embedPrimaryColor } from '@/features/cms/style-options'
import {
  type AirtableRecord,
  checkbox,
  choiceOr,
  optionalText,
  type RecordView,
  requiredLink,
  text,
  view as viewOf,
} from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import { type CmsEmbed, EMBED_DATE_FORMATS, EMBED_FORMATS, EMBED_VIEWS } from '@/types/cms'

export function mapCmsEmbed(record: AirtableRecord): CmsEmbed {
  const source = viewOf(TABLES.cmsEmbeds, record)
  const rawCss = optionalText(source, COL.extraCss)
  const extraCss = safeStoredEmbedCss(rawCss)

  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    name: text(source, COL.name),
    publicId: text(source, COL.publicId),
    format: choiceOr(source, COL.format, EMBED_FORMATS, 'styled_html'),
    view: choiceOr(source, COL.view, EMBED_VIEWS, 'agenda'),
    enabled: checkbox(source, COL.enabled),
    colorTheme: embedColorTheme(optionalText(source, COL.colorTheme)),
    primaryColor: embedPrimaryColor(optionalText(source, COL.primaryColor)),
    dateTimeFormat: choiceOr(source, COL.dateTimeFormat, EMBED_DATE_FORMATS, 'en_us_long'),
    // Spread rather than assigned, so an absent column is an absent property and the renderer's
    // "is there custom CSS at all" check stays a single `undefined` comparison.
    ...(extraCss === undefined ? {} : { extraCss }),
    // The organizer's own text, for the editor and for round-tripping a write. See `CmsEmbed`:
    // carrying only the sanitized copy meant an unrelated toggle rewrote or cleared the cell.
    ...(rawCss === undefined ? {} : { extraCssRaw: rawCss }),
    filters: normalizeEmbedFilters(jsonCell(source, COL.filtersJson)),
    fieldOptions: normalizeEmbedFieldOptions(jsonCell(source, COL.fieldOptionsJson)),
  }
}

/**
 * A JSON blob column, decoded far enough to hand to a normalizer.
 *
 * Not `jsonBlob` from records.ts, which THROWS on a cell that does not parse. That is the right
 * behaviour for a form's questions, where an empty wizard is unusable and has to be reported. It
 * is the wrong behaviour here: the two normalizers each have a documented fallback, and the
 * alternative is a served embed answering 500 on a third-party page over one malformed cell.
 */
function jsonCell(source: RecordView, field: string): unknown {
  const raw = optionalText(source, field)
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}
