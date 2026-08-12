// Ref 32's toolbar and card list, as a pure function. R9.
//
// Three controls sit above the list and all three interact, which is the whole reason this is
// a function with tests rather than three `filter` calls in a client component:
//
//   - the search box ("Search by name, format, or ID...")
//   - the segmented status filter, whose three counts are visible AT THE SAME TIME
//   - the collapsible group header, which shows a format name and a count
//
// The interaction that is easy to get wrong is the counts. They are computed over the SEARCH
// results and NOT over the selected segment: counting the selected segment only makes the
// other two read zero the moment one is chosen, and a control that cannot tell you there are
// two enabled embeds while you are looking at the disabled one is not the control ref 32
// shows, which has "All 1", "Enabled 1" and "Disabled 0" populated together.
//
// The group count is the count of MATCHING rows, not of rows on the event, for the same
// reason: a header reading "Styled HTML 3" above one visible card is a bug report.

import {
  type CmsEmbed,
  EMBED_FORMATS,
  type EmbedFormat,
  type EmbedView,
  embedFormatLabel,
  embedViewLabel,
} from '@/types/cms'

export const EMBED_STATUS_FILTERS = ['all', 'enabled', 'disabled'] as const
export type EmbedStatusFilter = (typeof EMBED_STATUS_FILTERS)[number]

/** Ref 32's segmented control, label and all. The counts come from the model. */
export const EMBED_STATUS_TABS: readonly { id: EmbedStatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'enabled', label: 'Enabled' },
  { id: 'disabled', label: 'Disabled' },
]

/** One card in ref 32's list. Everything the card renders and nothing else. */
export type EmbedListRow = {
  id: string
  name: string
  /** Shown on the card and searchable: it is the only id an organizer ever sees. */
  publicId: string
  format: EmbedFormat
  view: EmbedView
  viewLabel: string
  enabled: boolean
}

export type EmbedListGroup = {
  format: EmbedFormat
  label: string
  count: number
  rows: readonly EmbedListRow[]
}

export type EmbedListModel = {
  groups: readonly EmbedListGroup[]
  counts: Readonly<Record<EmbedStatusFilter, number>>
  /** Rows surviving both controls. Distinguishes "no embeds" from "no matches". */
  matched: number
}

export type EmbedListOptions = {
  search: string
  status: EmbedStatusFilter
}

export function embedListModel(
  embeds: readonly CmsEmbed[],
  options: EmbedListOptions,
): EmbedListModel {
  const found = embeds.filter((embed) => matchesSearch(embed, options.search))
  const rows = found
    .filter((embed) => matchesStatus(embed, options.status))
    .map(toRow)
    // Case-insensitive by name so the order is the one a reader sees, and by id after that so
    // two embeds sharing a name (which duplicating produces) do not swap places between reads.
    .toSorted(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    )

  return {
    // Bucketed, then walked in vocabulary order, rather than filtered once per format. A
    // format with no matching rows produces no bucket and therefore no header, which is what
    // "omit the empty group" means, and the order stays the vocabulary's rather than the order
    // the rows happen to arrive in.
    groups: groupRows(rows),
    counts: {
      all: found.length,
      enabled: found.filter((embed) => embed.enabled).length,
      disabled: found.filter((embed) => !embed.enabled).length,
    },
    matched: rows.length,
  }
}

function groupRows(rows: readonly EmbedListRow[]): readonly EmbedListGroup[] {
  const byFormat = new Map<EmbedFormat, EmbedListRow[]>()
  for (const row of rows) {
    const bucket = byFormat.get(row.format) ?? []
    bucket.push(row)
    byFormat.set(row.format, bucket)
  }

  return EMBED_FORMATS.flatMap((format) => {
    const bucket = byFormat.get(format)
    if (bucket === undefined) return []
    return [{ format, label: embedFormatLabel(format), count: bucket.length, rows: bucket }]
  })
}

function toRow(embed: CmsEmbed): EmbedListRow {
  return {
    id: embed.id,
    name: embed.name,
    publicId: embed.publicId,
    format: embed.format,
    view: embed.view,
    viewLabel: embedViewLabel(embed.view),
    enabled: embed.enabled,
  }
}

/**
 * Name, format or ID, per the placeholder copy.
 *
 * The format is matched on its LABEL ("Styled HTML") as well as its stored value
 * (`styled_html`), because the label is what ref 32 puts on the group header and therefore
 * the string an organizer would type. The record id is deliberately not searchable: it appears
 * nowhere in this surface, so matching it would be matching something nobody could have read
 * off the page, and it would make the record id look like a supported handle for an embed when
 * the entire point of `publicId` is that it is not.
 */
function matchesSearch(embed: CmsEmbed, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (needle === '') return true
  return [embed.name, embed.publicId, embed.format, embedFormatLabel(embed.format)].some(
    (candidate) => candidate.toLowerCase().includes(needle),
  )
}

function matchesStatus(embed: CmsEmbed, status: EmbedStatusFilter): boolean {
  if (status === 'all') return true
  return status === 'enabled' ? embed.enabled : !embed.enabled
}
