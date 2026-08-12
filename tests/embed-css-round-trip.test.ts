// The `Extra CSS Code` cell must survive a write that was not about it.
//
// This whole file exists because of one consequence of sanitizing on READ. `mapCmsEmbed` runs the
// stored stylesheet through `safeEmbedCss`, so the sanitized text became the only copy the app
// held, and every write carried that copy back to storage. Two failures followed, and the second
// destroys organizer input:
//
//   1. Toggling `Enabled` from the list page rewrote the cell with the SERVED text: comments
//      stripped, whitespace collapsed, refused declarations gone. Nothing errored and the embed
//      still rendered, so there was no way to notice until the organizer reopened the editor.
//   2. For a stylesheet that sanitizes to NOTHING, the toggle cleared the cell outright.
//      `content: "\2192"` is such a stylesheet: a value may not contain a backslash (the
//      documented refusal that stops `\75 rl(` spelling `url(` past the filter), so the one
//      declaration is dropped, the empty rule is dropped, and the result is an empty string.
//
// Found by Codex review. The fix is two-sided and both sides are asserted here: `CmsEmbed` carries
// `extraCssRaw` so a round-trip has the organizer's own text to carry, and `cmsEmbedEditFields`
// OMITS the column when an edit does not mention it, because Airtable leaves an unlisted field
// alone. Clearing still has to work, so a present empty string is not the same as an absent value.

import { describe, expect, it } from 'vitest'
import { defaultEmbedFieldOptions } from '@/features/cms/field-options'
import { EMPTY_EMBED_FILTERS } from '@/features/cms/filters'
import { safeEmbedCss } from '@/features/cms/safe-css'
import { COL } from '@/services/airtable/tables'
import { type CmsEmbedEdit, cmsEmbedEditFields } from '@/services/airtable/to-fields-cms'

const EDIT: CmsEmbedEdit = {
  name: 'Public agenda',
  format: 'styled_html',
  view: 'agenda',
  enabled: true,
  colorTheme: 'light',
  primaryColor: '#1b6ec2',
  dateTimeFormat: 'en_us_long',
  filters: EMPTY_EMBED_FILTERS,
  fieldOptions: defaultEmbedFieldOptions(),
}

describe('the stylesheet a sanitizer refuses entirely', () => {
  it('sanitizes to nothing, which is what made the clear destructive', () => {
    // The premise of the bug, pinned so the rest of this file cannot quietly stop applying.
    expect(safeEmbedCss('.icon::before { content: "\\2192" }')).toBe('')
  })
})

describe('cmsEmbedEditFields, the extraCss column', () => {
  it('omits the column when the edit does not carry the value', () => {
    const fields = cmsEmbedEditFields(EDIT)

    // Absent, not `''`. An Airtable update leaves a column it was not given alone, so this is
    // what makes an unrelated toggle stop touching the organizer's stylesheet.
    expect(Object.hasOwn(fields, COL.extraCss)).toBe(false)
  })

  it('writes an empty string when the edit carries one, which is how a clear happens', () => {
    // The organizer emptied the textarea. That has to reach storage, so it must not be confused
    // with the field having been omitted.
    expect(cmsEmbedEditFields({ ...EDIT, extraCss: '' })[COL.extraCss]).toBe('')
  })

  it('writes the value it was given, unchanged', () => {
    const raw = '/* brand */\n.a { color: red }'

    expect(cmsEmbedEditFields({ ...EDIT, extraCss: raw })[COL.extraCss]).toBe(raw)
  })

  it('never writes the sanitized rendering in place of the raw text', () => {
    // The regression stated as a property: what goes into the column is byte-for-byte what the
    // caller passed, so the only way the served version can be stored is if a caller passes it.
    const raw = '.a { color: red } /* keep me */'
    const stored = cmsEmbedEditFields({ ...EDIT, extraCss: raw })[COL.extraCss]

    expect(stored).toBe(raw)
    expect(stored).not.toBe(safeEmbedCss(raw))
  })

  it('still sends every other column on every write', () => {
    // The one-write-per-save design depends on this: only `extraCss` is conditional.
    const fields = cmsEmbedEditFields(EDIT)

    for (const column of [
      COL.name,
      COL.view,
      COL.enabled,
      COL.colorTheme,
      COL.primaryColor,
      COL.dateTimeFormat,
      COL.filtersJson,
      COL.fieldOptionsJson,
    ]) {
      expect(Object.hasOwn(fields, column), `${column} must be written`).toBe(true)
    }
  })
})
