// What the Filters panel offers, built from the event rather than from a vocabulary.
//
// Two of the five dimensions have no closed list this feature can import. `Submissions.format` and
// `Submissions.language` are singleSelects whose choices are declared privately inside
// src/migrations/tables-core.ts, and a separate workstream owns that file. Rather than restate them
// here (a second copy is the drift this repo's `COL` registry exists to prevent), both are DERIVED
// from the rows the embed can actually serve.
//
// That turns out to be the better control anyway: the panel offers only values that appear in this
// event's published feed, so an organizer cannot select a format no session has and then wonder why
// the embed is empty. Tracks, rooms and tags come from their own tables, because those are the
// event's own vocabulary and an organizer expects to see one they have defined even before a session
// uses it.
//
// The reference's own objects agree on the shapes: "Track carries id/name/color/order, Room carries
// id/name/order/capacity, and Format, Level, Language and Tag each carry id/name plus ordering." So
// a track choice carries its colour and a room choice does not.

import { embedChoiceLabel } from '@/features/cms/choice-label'
import { type EmbedFilterDimension, embedFilterLabel } from '@/features/cms/filters'
import type { Room, Tag, Track } from '@/types/domain'

/** One checkbox in the panel. `color` is present only where the source record has one. */
export type EmbedFilterChoice = { value: string; label: string; color?: string }

/**
 * One group in the panel.
 *
 * An array of plain objects rather than a `Map` keyed by dimension, because this crosses to a client
 * component: the panel is interactive, so everything it reads has to serialise.
 */
export type EmbedFilterGroup = {
  dimension: EmbedFilterDimension
  label: string
  choices: readonly EmbedFilterChoice[]
}

/** What the rows contribute: the two dimensions with no importable vocabulary. */
export type EmbedFilterSourceRow = { format?: string; language?: string }

export type EmbedFilterOptionsInput = {
  tracks: readonly Track[]
  rooms: readonly Room[]
  tags: readonly Tag[]
  rows: readonly EmbedFilterSourceRow[]
}

/**
 * The five groups, in the order the reference sentence lists the dimensions.
 *
 * A group with no choices is KEPT rather than dropped, and the panel renders it with a line saying
 * so. Dropping it would make an event with no tags yet look like an app with no tag filter, and the
 * organizer would go looking for the control instead of going to add a tag.
 */
export function embedFilterGroups(input: EmbedFilterOptionsInput): readonly EmbedFilterGroup[] {
  return [
    group('format', distinct(input.rows.map((row) => row.format)).map(labelled)),
    group('language', distinct(input.rows.map((row) => row.language)).map(labelled)),
    group('tag', named(input.tags)),
    group('track', named(input.tracks)),
    // Rooms carry no colour, so they get none. A swatch with a made-up colour on it would read as
    // data the organizer set.
    group(
      'room',
      input.rooms.map((room) => ({ value: room.id, label: room.name })),
    ),
  ]
}

function group(
  dimension: EmbedFilterDimension,
  choices: readonly EmbedFilterChoice[],
): EmbedFilterGroup {
  return { dimension, label: embedFilterLabel(dimension), choices }
}

function named(records: readonly { id: string; name: string; color: string }[]) {
  return records.map((record) => ({ value: record.id, label: record.name, color: record.color }))
}

/** Sorted and de-duplicated, so the list does not reshuffle between reads. */
function distinct(values: readonly (string | undefined)[]): readonly string[] {
  const seen = new Set<string>()
  for (const value of values) {
    if (value !== undefined && value !== '') seen.add(value)
  }
  return [...seen].toSorted((left, right) => left.localeCompare(right))
}

/**
 * `talk` becomes `Talk`.
 *
 * The stored value is what gets filtered on and is never rewritten; this is display only. The
 * labelling itself lives in @/features/cms/choice-label because the served embed now prints a
 * Format chip on every card and a Format facet beside it, and all three have to agree: a panel
 * offering `Talk` over cards reading `talk` is two spellings of one value.
 */
function labelled(value: string): EmbedFilterChoice {
  return { value, label: embedChoiceLabel(value) }
}
