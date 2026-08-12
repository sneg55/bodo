// Library > Tags: the shape of a track, tag or room edit, and the rules over it.
//
// Three kinds on one screen because BUILD_SPEC 5.0b puts them there ("Library > Tags is
// CRUD over the Tags table, and Tracks live alongside it") and because nothing else in the
// build can create any of them: routing files a submission under a Track, the agenda
// schedules into a Room, and both were seed-only until now.
//
// The rules are here rather than in the action so they can be unit tested without a base.
// The one that matters is the duplicate check: `Submissions.track` is a LINK, so two tracks
// called "AI Engineering" are two different categories that read identically in every
// picker, and routing rules point at one of them by record id.

import type { RecordId } from '@/types/domain'

export type LookupKind = 'track' | 'tag' | 'room'

export const LOOKUP_NAME_MAX_LENGTH = 80

export type LookupEntry = {
  readonly id: RecordId
  readonly name: string
}

export type LookupProblem = { readonly message: string }

/** Labels for the tab strip and for every message, so the copy is spelled once. */
export const LOOKUP_LABELS: ReadonlyMap<LookupKind, { plural: string; singular: string }> = new Map(
  [
    ['track', { plural: 'Tracks', singular: 'Track' }],
    ['tag', { plural: 'Tags', singular: 'Tag' }],
    ['room', { plural: 'Rooms', singular: 'Room' }],
  ],
)

export function lookupLabel(kind: LookupKind): { plural: string; singular: string } {
  return LOOKUP_LABELS.get(kind) ?? { plural: kind, singular: kind }
}

/**
 * Check a proposed name against the entries that already exist.
 *
 * `selfId` is the row being renamed, so renaming "AI" to "AI" is not a collision with
 * itself. Absent when adding.
 */
export function checkLookupName(
  kind: LookupKind,
  name: string,
  existing: readonly LookupEntry[],
  selfId?: RecordId,
): LookupProblem | undefined {
  const label = lookupLabel(kind).singular
  const trimmed = name.trim()

  if (trimmed === '') return { message: `${label} name is required.` }
  if (trimmed.length > LOOKUP_NAME_MAX_LENGTH) {
    return {
      message: `${label} name must be ${String(LOOKUP_NAME_MAX_LENGTH)} characters or fewer.`,
    }
  }

  const clash = existing.some(
    (entry) => entry.id !== selfId && entry.name.trim().toLowerCase() === trimmed.toLowerCase(),
  )
  return clash ? { message: `${label} "${trimmed}" already exists on this event.` } : undefined
}

/**
 * The `order` a new track or room gets: one past the highest in use.
 *
 * Appending rather than renumbering, because `order` is what the agenda's room columns and
 * the track legend sort by, and renumbering on every add would rewrite every row.
 */
export function nextLookupOrder(existingOrders: readonly number[]): number {
  const highest = existingOrders.reduce((max, order) => (order > max ? order : max), 0)
  return highest + 1
}
