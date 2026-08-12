// The Filters section, as rules rather than as a panel.
//
// Reference: docs/parity/external-references.md, "Embed Filters and Field Options". The knowledge
// base says "apply filters such as specific tracks or statuses", and for the session list it
// enumerates the dimensions: "filterable by format, language, tag, track, location". Neither
// source lists the controls, so what is transcribed is the DIMENSIONS and the count badge; the
// combination semantics below are ours and are pinned here because they are the part that fails
// silently. A filter that quietly matches everything is a feed serving content an organizer
// believes they excluded.
//
// Two properties matter more than the rest:
//
//   1. OR within a dimension, AND across dimensions. Two tracks means "either track"; a track
//      plus a language means "that track AND that language". The other reading (AND everywhere)
//      makes every two-value selection serve nothing, which reads as broken data.
//   2. A row MISSING the value on a filtered dimension is excluded. A session with no track
//      cannot satisfy "track is Agents", and including it would put unlabelled sessions into
//      every track-filtered feed.

import { describe, expect, it } from 'vitest'

import {
  applyEmbedFilters,
  EMBED_FILTER_DIMENSIONS,
  EMPTY_EMBED_FILTERS,
  type EmbedFilterableRow,
  embedFilterCount,
  embedFilterValues,
  normalizeEmbedFilters,
  toggleEmbedFilter,
} from '@/features/cms/filters'

function row(patch: Partial<EmbedFilterableRow> & { id: string }): EmbedFilterableRow & {
  id: string
} {
  return {
    trackId: 'recTrackAgents',
    roomId: 'recRoomMain',
    tagIds: ['recTagAi'],
    format: 'talk',
    language: 'English',
    ...patch,
  }
}

const ROWS = [
  row({ id: 's1' }),
  row({
    id: 's2',
    trackId: 'recTrackOps',
    roomId: 'recRoomSide',
    tagIds: ['recTagOps', 'recTagAi'],
    format: 'workshop',
    language: 'Spanish',
  }),
  row({ id: 's3', trackId: undefined, roomId: undefined, tagIds: [], format: undefined }),
]

function ids(rows: readonly { id: string }[]): readonly string[] {
  return rows.map((entry) => entry.id)
}

describe('applyEmbedFilters', () => {
  it('serves every row when nothing is applied', () => {
    expect(ids(applyEmbedFilters(ROWS, EMPTY_EMBED_FILTERS))).toEqual(['s1', 's2', 's3'])
  })

  it('narrows to one track', () => {
    const filters = { ...EMPTY_EMBED_FILTERS, trackIds: ['recTrackAgents'] }

    expect(ids(applyEmbedFilters(ROWS, filters))).toEqual(['s1'])
  })

  it('treats two values on one dimension as either, not both', () => {
    const filters = { ...EMPTY_EMBED_FILTERS, trackIds: ['recTrackAgents', 'recTrackOps'] }

    expect(ids(applyEmbedFilters(ROWS, filters))).toEqual(['s1', 's2'])
  })

  it('treats two dimensions as both', () => {
    const filters = { ...EMPTY_EMBED_FILTERS, trackIds: ['recTrackOps'], languages: ['English'] }

    expect(applyEmbedFilters(ROWS, filters)).toEqual([])
  })

  it('excludes a row that has no value on a filtered dimension', () => {
    // s3 has no track. It must not fall through a track filter just because the cell is blank.
    const filters = { ...EMPTY_EMBED_FILTERS, trackIds: ['recTrackAgents'] }

    expect(ids(applyEmbedFilters(ROWS, filters))).not.toContain('s3')
  })

  it('matches a tag when the row carries it among others', () => {
    const filters = { ...EMPTY_EMBED_FILTERS, tagIds: ['recTagAi'] }

    expect(ids(applyEmbedFilters(ROWS, filters))).toEqual(['s1', 's2'])
  })

  it('narrows by room and by format and by language', () => {
    expect(
      ids(applyEmbedFilters(ROWS, { ...EMPTY_EMBED_FILTERS, roomIds: ['recRoomSide'] })),
    ).toEqual(['s2'])
    expect(ids(applyEmbedFilters(ROWS, { ...EMPTY_EMBED_FILTERS, formats: ['workshop'] }))).toEqual(
      ['s2'],
    )
    expect(
      ids(applyEmbedFilters(ROWS, { ...EMPTY_EMBED_FILTERS, languages: ['Spanish'] })),
    ).toEqual(['s2'])
  })

  it('serves nothing rather than everything when a filter names a deleted record', () => {
    // The safe direction. A track an organizer removed leaves a filter that matches nobody, which
    // is visible; the other reading silently publishes the whole feed.
    const filters = { ...EMPTY_EMBED_FILTERS, trackIds: ['recTrackDeleted'] }

    expect(applyEmbedFilters(ROWS, filters)).toEqual([])
  })
})

describe('embedFilterCount, the badge on ref 33 reading "1"', () => {
  it('is zero when nothing is applied', () => {
    expect(embedFilterCount(EMPTY_EMBED_FILTERS)).toBe(0)
  })

  it('counts every selected value, not every dimension', () => {
    const filters = {
      ...EMPTY_EMBED_FILTERS,
      trackIds: ['a', 'b'],
      formats: ['talk'],
    }

    expect(embedFilterCount(filters)).toBe(3)
  })
})

describe('toggleEmbedFilter', () => {
  it('adds and removes one value without disturbing the others', () => {
    const withTrack = toggleEmbedFilter(EMPTY_EMBED_FILTERS, 'track', 'recTrackAgents', true)
    const withBoth = toggleEmbedFilter(withTrack, 'format', 'talk', true)

    expect(embedFilterValues(withBoth, 'track')).toEqual(['recTrackAgents'])
    expect(embedFilterValues(withBoth, 'format')).toEqual(['talk'])

    const off = toggleEmbedFilter(withBoth, 'track', 'recTrackAgents', false)
    expect(embedFilterValues(off, 'track')).toEqual([])
    expect(embedFilterValues(off, 'format')).toEqual(['talk'])
  })

  it('does not add the same value twice', () => {
    const once = toggleEmbedFilter(EMPTY_EMBED_FILTERS, 'tag', 'recTagAi', true)
    const twice = toggleEmbedFilter(once, 'tag', 'recTagAi', true)

    expect(embedFilterValues(twice, 'tag')).toEqual(['recTagAi'])
  })

  it('covers every dimension the panel renders, and never a status one', () => {
    // Status is absent on purpose. `ACCEPTED_STATUSES` is `['accepted']`, so every row an embed can
    // serve is already accepted and a status checkbox could only narrow nothing.
    expect([...EMBED_FILTER_DIMENSIONS]).not.toContain('status')
  })

  it('round-trips every dimension through the stored blob', () => {
    for (const dimension of EMBED_FILTER_DIMENSIONS) {
      const set = toggleEmbedFilter(EMPTY_EMBED_FILTERS, dimension, 'x', true)
      const back = normalizeEmbedFilters(JSON.parse(JSON.stringify(set)))

      expect(embedFilterValues(back, dimension)).toEqual(['x'])
    }
  })

  it('reads a missing or malformed blob as no filters at all', () => {
    // The safe direction on a page this app does not control: serve the whole published feed
    // rather than nothing, since it is the same content /agenda/<slug> already shows.
    for (const raw of [undefined, null, 'nonsense', 7, [], { trackIds: 'recTrack' }]) {
      expect(normalizeEmbedFilters(raw)).toEqual(EMPTY_EMBED_FILTERS)
    }
  })

  it('drops a non-string entry inside an otherwise valid blob', () => {
    const filters = normalizeEmbedFilters({ trackIds: ['recTrack', 3, '', null] })

    expect(embedFilterValues(filters, 'track')).toEqual(['recTrack'])
  })

  it('applies to each dimension in turn', () => {
    for (const dimension of EMBED_FILTER_DIMENSIONS) {
      const next = toggleEmbedFilter(EMPTY_EMBED_FILTERS, dimension, 'x', true)

      expect(embedFilterValues(next, dimension)).toEqual(['x'])
      expect(embedFilterCount(next)).toBe(1)
    }
  })
})
