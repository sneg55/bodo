// The Filters section of ref 33's left pane, as rules. R9.
//
// Reference: docs/parity/external-references.md, "Embed Filters and Field Options". Both of our
// screenshots have this section collapsed and ref 33 shows only its count badge reading `1`;
// Sessionboard's knowledge base supplies the rest. Transcribed from it: there is a filter section
// at all, it carries an applied-filter count, and the dimensions for the session list are
// "filterable by format, language, tag, track, location".
//
// SO THERE ARE FIVE DIMENSIONS HERE AND NOT SIX. The same reference sentence also says "apply
// filters such as specific tracks or statuses", and STATUS IS DELIBERATELY ABSENT. That is not an
// oversight and it is not effort:
//
//   - `publicAgendaRows` (@/features/agenda/public-agenda) is the one function every public read
//     passes through, and it admits a row only when `ACCEPTED_STATUSES.includes(row.status)`.
//   - `ACCEPTED_STATUSES` is `['accepted']` (src/constants/status.ts). Not a subset of a wider
//     public set: literally one value.
//
// So every row an embed can serve already has `status: 'accepted'`, and a status control could
// only ever do one of two things: nothing at all, or publish a pending or declined session on the
// conference's website. The developer docs list the product's own status enum as `accepted,
// accept_queue, pending, decline_queue, declined`, which reconciles with our vocabulary except
// that four of those five are not publishable here. A checkbox that narrows nothing is exactly the
// defect this surface keeps producing, so the honest build is five dimensions and this comment.
//
// `location` is spelled `room` throughout, because Rooms is the table we store and the reference's
// own Room object (id, name, order, capacity) is what that filter is over. `Submissions.location`
// is a separate free-text column that no room filter should be reading.
//
// The combination semantics are OURS, and they are the part that fails silently:
//
//   OR within a dimension, AND across dimensions. Two tracks means either track; a track plus a
//   language means that track and that language. Reading it as AND everywhere makes every
//   two-value selection serve nothing, which an organizer reads as broken data rather than as a
//   filter they set.
//
//   A row with NO value on a filtered dimension is excluded. A session with no track cannot
//   satisfy "track is Agents", and admitting it would drop every unlabelled session into every
//   track-filtered feed.

import type { EmbedFilters } from '@/types/cms'

/** The five groups the panel renders, in the order the reference sentence lists them. */
export const EMBED_FILTER_DIMENSIONS = ['format', 'language', 'tag', 'track', 'room'] as const
export type EmbedFilterDimension = (typeof EMBED_FILTER_DIMENSIONS)[number]

/** A new embed serves the whole feed. See the note on `EmbedFilters`. */
export const EMPTY_EMBED_FILTERS: EmbedFilters = {
  trackIds: [],
  roomIds: [],
  tagIds: [],
  formats: [],
  languages: [],
}

/** What the filters need off a submission row. `SubmissionWithParticipants` satisfies it. */
export type EmbedFilterableRow = {
  trackId?: string
  roomId?: string
  tagIds: readonly string[]
  format?: string
  language?: string
}

/** The group headings in the panel. Our wording: no source captures these labels. */
const DIMENSION_LABELS = new Map<EmbedFilterDimension, string>([
  ['format', 'Format'],
  ['language', 'Language'],
  ['tag', 'Tag'],
  ['track', 'Track'],
  ['room', 'Room'],
])

export function embedFilterLabel(dimension: EmbedFilterDimension): string {
  return DIMENSION_LABELS.get(dimension) ?? dimension
}

/**
 * The values selected on one dimension.
 *
 * A switch rather than an index, for the reason src/types/cms.ts gives about its label maps: a
 * computed member access on a record keyed by a variable is what `security/detect-object-injection`
 * refuses, and the lint hook runs at zero warnings. The switch is exhaustive over the union, so a
 * sixth dimension is a type error here rather than a group that silently filters nothing.
 */
export function embedFilterValues(
  filters: EmbedFilters,
  dimension: EmbedFilterDimension,
): readonly string[] {
  switch (dimension) {
    case 'format':
      return filters.formats
    case 'language':
      return filters.languages
    case 'tag':
      return filters.tagIds
    case 'track':
      return filters.trackIds
    case 'room':
      return filters.roomIds
  }
}

/** One dimension replaced, the rest untouched. */
export function withEmbedFilterValues(
  filters: EmbedFilters,
  dimension: EmbedFilterDimension,
  values: readonly string[],
): EmbedFilters {
  switch (dimension) {
    case 'format':
      return { ...filters, formats: values }
    case 'language':
      return { ...filters, languages: values }
    case 'tag':
      return { ...filters, tagIds: values }
    case 'track':
      return { ...filters, trackIds: values }
    case 'room':
      return { ...filters, roomIds: values }
  }
}

/** One checkbox in the panel. Idempotent in both directions. */
export function toggleEmbedFilter(
  filters: EmbedFilters,
  dimension: EmbedFilterDimension,
  value: string,
  on: boolean,
): EmbedFilters {
  const current = embedFilterValues(filters, dimension)
  const next = on
    ? current.includes(value)
      ? current
      : [...current, value]
    : current.filter((entry) => entry !== value)
  return withEmbedFilterValues(filters, dimension, next)
}

/**
 * The number on ref 33's badge.
 *
 * Every selected VALUE, not every active dimension: "Filters 3" over two tracks and one format
 * says how much has been narrowed, where "Filters 2" would say only that two groups are in play.
 */
export function embedFilterCount(filters: EmbedFilters): number {
  return EMBED_FILTER_DIMENSIONS.reduce(
    (total, dimension) => total + embedFilterValues(filters, dimension).length,
    0,
  )
}

/**
 * A stored blob, made safe to read.
 *
 * Falls back to NO filters rather than throwing, and that direction is the opposite of the one
 * `jsonBlob` in records.ts takes for a form's questions, deliberately. A form with an unparseable
 * blob has to fail loudly, because a wizard with no questions is unusable. An embed with an
 * unparseable filter blob would fail on a page this app does not control, so it serves the whole
 * published feed instead: the same content the event's own agenda page already shows, which is
 * wider than the organizer asked for but is never something they had not published.
 *
 * Values are kept as strings without checking that they name a live record. A track deleted after
 * the filter was set leaves a value that matches nobody, which `applyEmbedFilters` turns into an
 * empty feed. Visible, and the safe direction.
 */
export function normalizeEmbedFilters(raw: unknown): EmbedFilters {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_EMBED_FILTERS
  // Copied into a Map before any lookup, as records.ts does with Airtable field sets: this came
  // off the wire, so indexing it with a variable key can read the prototype chain.
  const entries = new Map(Object.entries(raw))

  return EMBED_FILTER_DIMENSIONS.reduce<EmbedFilters>(
    (filters, dimension) =>
      withEmbedFilterValues(filters, dimension, strings(entries.get(storedKey(dimension)))),
    EMPTY_EMBED_FILTERS,
  )
}

/** The JSON key one dimension is stored under. The property name on `EmbedFilters`. */
function storedKey(dimension: EmbedFilterDimension): string {
  switch (dimension) {
    case 'format':
      return 'formats'
    case 'language':
      return 'languages'
    case 'tag':
      return 'tagIds'
    case 'track':
      return 'trackIds'
    case 'room':
      return 'roomIds'
  }
}

function strings(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
}

/** Whether an organizer has narrowed anything at all. */
export function hasEmbedFilters(filters: EmbedFilters): boolean {
  return embedFilterCount(filters) > 0
}

/**
 * The feed, narrowed.
 *
 * Generic over the row so the projection can pass its own richer type through without a cast, and
 * so a test cannot assert against a shape the app does not have.
 */
export function applyEmbedFilters<T extends EmbedFilterableRow>(
  rows: readonly T[],
  filters: EmbedFilters,
): readonly T[] {
  if (!hasEmbedFilters(filters)) return rows
  return rows.filter((row) => EMBED_FILTER_DIMENSIONS.every((d) => matches(row, filters, d)))
}

function matches(
  row: EmbedFilterableRow,
  filters: EmbedFilters,
  dimension: EmbedFilterDimension,
): boolean {
  const selected = embedFilterValues(filters, dimension)
  if (selected.length === 0) return true
  if (dimension === 'tag') return row.tagIds.some((id) => selected.includes(id))

  const value = rowValue(row, dimension)
  // Absent excluded, never admitted. See the header.
  return value !== undefined && selected.includes(value)
}

function rowValue(
  row: EmbedFilterableRow,
  dimension: Exclude<EmbedFilterDimension, 'tag'>,
): string | undefined {
  switch (dimension) {
    case 'format':
      return row.format
    case 'language':
      return row.language
    case 'track':
      return row.trackId
    case 'room':
      return row.roomId
  }
}
