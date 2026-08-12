// The write boundary for the three new editor sections.
//
// A Server Action is reachable by POST with no editor involved (BUILD_SPEC 4), so "the control is a
// Select" says nothing about what arrives. These cases are the ones where getting it wrong is
// silent: a fallback that reverts a working embed, a colour that reaches the page as a stylesheet,
// or an `Extra CSS Code` field that cannot be emptied once it has been filled.

import { describe, expect, it } from 'vitest'

import { embedDraftForm, embedDraftFrom } from '@/features/cms/draft'
import { defaultEmbedFieldOptions, toggleEmbedField } from '@/features/cms/field-options'
import { EMPTY_EMBED_FILTERS, toggleEmbedFilter } from '@/features/cms/filters'
import { parseEmbedSave } from '@/features/cms/save-payload'
import type { CmsEmbed } from '@/types/cms'

const EXISTING: CmsEmbed = {
  id: 'recEmbed',
  eventId: 'recEvent',
  name: 'Public agenda',
  publicId: 'agn7Kq2',
  format: 'styled_html',
  view: 'schedule_itinerary',
  enabled: true,
  colorTheme: 'dark',
  primaryColor: '#0b1c33',
  dateTimeFormat: 'iso',
  // Two copies on purpose, and they DIFFER, which is what the round-trip has to get right:
  // `extraCss` is what `mapCmsEmbed` sanitized for the public page, `extraCssRaw` is what the
  // organizer typed. A save that omits the field must carry the raw text forward, not the served
  // rendering of it. Found by Codex review.
  extraCss: '.a{color:red;}',
  extraCssRaw: '/* brand */\n.a { color: red }',
  filters: { ...EMPTY_EMBED_FILTERS, trackIds: ['recTrackAgents'] },
  fieldOptions: defaultEmbedFieldOptions(),
}

function post(entries: Readonly<Record<string, string>>): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries(entries)) form.set(key, value)
  return form
}

function savedAgainst(entries: Readonly<Record<string, string>>, existing: CmsEmbed) {
  const result = parseEmbedSave(post({ name: 'Public agenda', ...entries }), existing)
  if (!result.ok) throw new Error(`expected a save, got: ${result.message}`)
  return result.edit
}

function saved(entries: Readonly<Record<string, string>>) {
  return savedAgainst(entries, EXISTING)
}

describe('parseEmbedSave, refusals', () => {
  it('refuses a blank name with a message an organizer can act on', () => {
    const result = parseEmbedSave(post({ name: '   ' }), EXISTING)

    expect(result).toEqual({ ok: false, message: 'Name is required.' })
  })

  it('refuses a colour that is not a hex, naming the captured example', () => {
    const result = parseEmbedSave(post({ name: 'x', primaryColor: 'red' }), EXISTING)

    expect(result.ok).toBe(false)
  })

  it('refuses a declaration smuggled through the colour field', () => {
    const result = parseEmbedSave(
      post({ name: 'x', primaryColor: '#fff; } body { display: none }' }),
      EXISTING,
    )

    expect(result.ok).toBe(false)
  })
})

describe('parseEmbedSave, fallbacks', () => {
  it('keeps the stored view, theme and date format when the post omits them', () => {
    const edit = saved({})

    expect(edit.view).toBe('schedule_itinerary')
    expect(edit.colorTheme).toBe('dark')
    expect(edit.dateTimeFormat).toBe('iso')
  })

  it('keeps the stored values rather than a global default when the post invents one', () => {
    const edit = saved({ view: 'gallery', colorTheme: 'neon', dateTimeFormat: 'klingon' })

    expect(edit.view).toBe('schedule_itinerary')
    expect(edit.colorTheme).toBe('dark')
    expect(edit.dateTimeFormat).toBe('iso')
  })

  it('reads an absent enabled field as off, the way a form reports a cleared switch', () => {
    expect(saved({}).enabled).toBe(false)
    expect(saved({ enabled: 'on' }).enabled).toBe(true)
  })

  it('normalises the colour to lower case', () => {
    expect(saved({ primaryColor: '#1B6EC2' }).primaryColor).toBe('#1b6ec2')
  })
})

describe('parseEmbedSave, Extra CSS Code', () => {
  it('keeps the stored stylesheet, as TYPED, when the field is absent', () => {
    // Not `.a{color:red;}`, which is the sanitized copy. Writing that back would replace the
    // organizer's stylesheet with the served version of it on every unrelated save.
    expect(saved({}).extraCss).toBe(EXISTING.extraCssRaw)
  })

  it('clears the stored stylesheet when the field arrives empty', () => {
    // The only way an organizer removes custom CSS from a live embed, so it must not read as
    // "unchanged". `cmsEmbedEditFields` writes an empty string as a cleared cell.
    expect(saved({ extraCss: '' }).extraCss).toBe('')
  })

  it('stores what was typed rather than sanitizing on the way in', () => {
    // Sanitizing happens in the mapper, on the way out. Doing it here as well would mean the
    // editor could never show an organizer the code they wrote, and would guarantee nothing,
    // because the Airtable cell is writable directly.
    expect(saved({ extraCss: '.a { color: red } </style>' }).extraCss).toContain('</style>')
  })

  it('caps the stored stylesheet at the sanitizer budget', () => {
    expect(saved({ extraCss: 'x'.repeat(50_000) }).extraCss).toHaveLength(20_000)
  })
})

describe('parseEmbedSave, the two blobs', () => {
  it('round-trips a filter selection', () => {
    const edit = saved({ filters: JSON.stringify({ formats: ['talk'], tagIds: ['recTagAi'] }) })

    expect(edit.filters.formats).toEqual(['talk'])
    expect(edit.filters.tagIds).toEqual(['recTagAi'])
  })

  it('reads a malformed filter blob as no filters, not as the stored ones', () => {
    // A post that could not describe its filters is not evidence about what they were.
    expect(saved({ filters: '{oops' }).filters).toEqual(EMPTY_EMBED_FILTERS)
  })

  it('drops a field name the post invented', () => {
    const edit = saved({ fieldOptions: JSON.stringify({ speaker: ['email', 'company'] }) })

    expect(edit.fieldOptions.speaker).toEqual(['company'])
  })

  it('honours an explicitly empty card selection', () => {
    const edit = saved({ fieldOptions: JSON.stringify({ agenda: [] }) })

    expect(edit.fieldOptions.agenda).toEqual([])
  })
})

describe('the editor draft round-trips through the posted form', () => {
  // This pair IS the wire format between the four client panels and the Server Action. A renamed
  // field on one side is a control that silently saves nothing, which no type checks: `FormData`
  // keys are strings.
  function roundTrip(patch: Partial<ReturnType<typeof embedDraftFrom>>) {
    const draft = { ...embedDraftFrom(EXISTING), ...patch }
    const result = parseEmbedSave(embedDraftForm(draft), EXISTING)
    if (!result.ok) throw new Error(`expected a save, got: ${result.message}`)
    return result.edit
  }

  it('preserves an untouched draft exactly', () => {
    const edit = roundTrip({})

    expect(edit).toEqual({
      name: EXISTING.name,
      format: EXISTING.format,
      view: EXISTING.view,
      enabled: EXISTING.enabled,
      colorTheme: EXISTING.colorTheme,
      primaryColor: EXISTING.primaryColor,
      dateTimeFormat: EXISTING.dateTimeFormat,
      extraCss: EXISTING.extraCssRaw,
      filters: EXISTING.filters,
      fieldOptions: EXISTING.fieldOptions,
    })
  })

  it('carries a format change, which is what unlocking the Format field means', () => {
    // The column used not to be sent at all (the "Locked" badge), so a format change would have
    // saved nothing and the embed would have kept serving its old representation.
    expect(roundTrip({ format: 'ical' }).format).toBe('ical')
    expect(roundTrip({ format: 'json' }).format).toBe('json')
  })

  it('carries a view change, which is what EMB-15 makes possible', () => {
    // The settings panel's Type section owns `view` now, and posts it like any other field: a
    // newly created embed, or one already saved as Agenda, must be settable to any of the other
    // four widget types through the ordinary Save flow rather than through a side channel.
    expect(roundTrip({ view: 'session_list' }).view).toBe('session_list')
    expect(roundTrip({ view: 'speaker_gallery' }).view).toBe('speaker_gallery')
  })

  it('keeps the stored format when the post names one that does not exist', () => {
    // A Server Action is reachable by POST with no editor involved. Falling back to the stored
    // value rather than to `styled_html` is the safe direction: a hand-built post must not turn a
    // JSON feed somebody's site is consuming back into an HTML page.
    const form = embedDraftForm(embedDraftFrom({ ...EXISTING, format: 'json' }))
    form.set('format', 'rss')
    const result = parseEmbedSave(form, { ...EXISTING, format: 'json' })
    if (!result.ok) throw new Error(result.message)

    expect(result.edit.format).toBe('json')
  })

  it('carries every Style Options change', () => {
    const edit = roundTrip({
      colorTheme: 'light',
      primaryColor: '#1b6ec2',
      dateTimeFormat: 'en_us_long',
      extraCss: '.b { color: blue }',
    })

    expect(edit.colorTheme).toBe('light')
    expect(edit.primaryColor).toBe('#1b6ec2')
    expect(edit.dateTimeFormat).toBe('en_us_long')
    expect(edit.extraCss).toBe('.b { color: blue }')
  })

  it('carries a filter toggle and a field deselection', () => {
    const edit = roundTrip({
      filters: toggleEmbedFilter(EMPTY_EMBED_FILTERS, 'format', 'workshop', true),
      fieldOptions: toggleEmbedField(defaultEmbedFieldOptions(), 'speaker', 'company', false),
    })

    expect(edit.filters.formats).toEqual(['workshop'])
    expect(edit.fieldOptions.speaker).not.toContain('company')
  })

  it('reports a switched-off embed by omitting the field, not by sending false', () => {
    expect(embedDraftForm({ ...embedDraftFrom(EXISTING), enabled: false }).has('enabled')).toBe(
      false,
    )
    expect(roundTrip({ enabled: false }).enabled).toBe(false)
  })
})

describe('parseEmbedSave, a post that omits the JSON sections', () => {
  // Both arrive as hidden JSON inputs, so absent means the client did not send them (a stale tab,
  // a partial post, a hand-built form) and never means the organizer cleared them. Falling back to
  // the normalizer's default was a live-embed defect: an empty filter set is the BROADEST one, so
  // an omitted `filters` republished every session the organizer had filtered out. Found by Codex
  // review.
  it('keeps the stored filters rather than reverting to the broadest set', () => {
    expect(saved({}).filters).toEqual(EXISTING.filters)
  })

  it('keeps the stored field selection rather than switching every field back on', () => {
    const narrowed = {
      ...EXISTING,
      fieldOptions: { ...EXISTING.fieldOptions, agenda: ['title'] },
    }

    expect(savedAgainst({}, narrowed).fieldOptions).toEqual(narrowed.fieldOptions)
  })

  it('still normalizes a section that WAS sent, however malformed', () => {
    // Sending the field is a claim to have edited it, so it goes through the normalizer. Only
    // absence means "leave it alone".
    expect(saved({ filters: 'not json at all' }).filters).toEqual(EMPTY_EMBED_FILTERS)
  })
})
