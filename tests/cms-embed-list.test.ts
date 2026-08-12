import { describe, expect, it } from 'vitest'
import { defaultEmbedFieldOptions } from '@/features/cms/field-options'
import { EMPTY_EMBED_FILTERS } from '@/features/cms/filters'
import { embedListModel } from '@/features/cms/list-model'
import type { CmsEmbed } from '@/types/cms'
import { EMBED_DEFAULTS } from '@/types/cms'

function embed(patch: Partial<CmsEmbed> & { id: string }): CmsEmbed {
  return {
    eventId: 'recEvent',
    name: 'New Embed',
    publicId: `pub-${patch.id}`,
    format: 'styled_html',
    view: 'agenda',
    enabled: true,
    // Style Options, Filters and Field Options play no part in the list model: ref 32's card shows
    // a name, a status pill and two icon buttons. Filled from the shared defaults so this helper
    // does not have to be revisited every time the editor grows a control.
    ...EMBED_DEFAULTS,
    filters: EMPTY_EMBED_FILTERS,
    fieldOptions: defaultEmbedFieldOptions(),
    ...patch,
  }
}

const EMBEDS = [
  embed({ id: 'e1', name: 'Public agenda', publicId: 'agn7Kq2', view: 'agenda' }),
  embed({ id: 'e2', name: 'Speaker wall', publicId: 'spk9Zz1', view: 'speaker_gallery' }),
  embed({ id: 'e3', name: 'Sponsor itinerary', publicId: 'itn3Bb8', enabled: false }),
]

const ALL = { search: '', status: 'all' } as const

describe('embed list model', () => {
  it('groups by format and counts the group, matching ref 32 header "Styled HTML 1"', () => {
    const model = embedListModel([embed({ id: 'e1' })], ALL)

    expect(model.groups).toHaveLength(1)
    expect(model.groups[0]?.label).toBe('Styled HTML')
    expect(model.groups[0]?.count).toBe(1)
    expect(model.groups[0]?.rows.map((row) => row.id)).toEqual(['e1'])
  })

  it('omits a format group with no matching rows rather than rendering an empty header', () => {
    const model = embedListModel(EMBEDS, { search: 'nothing matches this', status: 'all' })

    expect(model.groups).toEqual([])
    expect(model.matched).toBe(0)
  })

  it('searches by name, case and whitespace insensitively', () => {
    const model = embedListModel(EMBEDS, { search: '  SPEAKER wall ', status: 'all' })

    expect(model.groups.flatMap((group) => group.rows).map((row) => row.id)).toEqual(['e2'])
  })

  it('searches by format, using the label an organizer can actually see', () => {
    const model = embedListModel(EMBEDS, { search: 'styled html', status: 'all' })

    expect(model.matched).toBe(3)
  })

  it('searches by ID, which is the opaque publicId and never the record id', () => {
    const byPublicId = embedListModel(EMBEDS, { search: 'itn3Bb8', status: 'all' })
    expect(byPublicId.groups.flatMap((group) => group.rows).map((row) => row.id)).toEqual(['e3'])

    // A record id is not searchable on purpose: it is not shown anywhere in the surface, so
    // matching it would be matching a string the organizer cannot have read off the page.
    const byRecordId = embedListModel(EMBEDS, { search: 'e3', status: 'all' })
    expect(byRecordId.matched).toBe(0)
  })

  it('filters by status', () => {
    const enabled = embedListModel(EMBEDS, { search: '', status: 'enabled' })
    expect(enabled.groups.flatMap((group) => group.rows).map((row) => row.id)).toEqual(['e1', 'e2'])

    const disabled = embedListModel(EMBEDS, { search: '', status: 'disabled' })
    expect(disabled.groups.flatMap((group) => group.rows).map((row) => row.id)).toEqual(['e3'])
  })

  it('counts every segment over the SEARCH results, not over the selected segment', () => {
    // Otherwise selecting Disabled zeroes the Enabled count next to it, and the control
    // stops being a way back: ref 32 shows all three counts populated at once.
    const model = embedListModel(EMBEDS, { search: '', status: 'disabled' })

    expect(model.counts).toEqual({ all: 3, enabled: 2, disabled: 1 })
  })

  it('narrows the counts when a search is active', () => {
    const model = embedListModel(EMBEDS, { search: 'itinerary', status: 'all' })

    expect(model.counts).toEqual({ all: 1, enabled: 0, disabled: 1 })
  })

  it('orders rows within a group by name, so the list does not reshuffle on every read', () => {
    const model = embedListModel(
      [embed({ id: 'e1', name: 'zeta' }), embed({ id: 'e2', name: 'Alpha' })],
      ALL,
    )

    expect(model.groups[0]?.rows.map((row) => row.name)).toEqual(['Alpha', 'zeta'])
  })

  it('carries the view label onto the row, since one Styled HTML embed can be any of five', () => {
    const model = embedListModel([embed({ id: 'e1', view: 'schedule_itinerary' })], ALL)

    expect(model.groups[0]?.rows[0]?.viewLabel).toBe('Schedule Itinerary')
  })
})
