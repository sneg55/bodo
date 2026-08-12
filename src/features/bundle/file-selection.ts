// Selecting a bundle by FILE rather than by session, for the two admin Files lists.
//
// `./selection` answers "the organizer ticked some sessions"; this answers "the organizer
// ticked some rows on SUBMISSIONS > Files or PORTALS > Files". They are different questions
// and only one of them can serve the portal list at all: a portal file hangs off a speaker
// and no submission (features/files/file-rows.ts holds that partition), so a session-scoped
// selection can never reach a headshot or a delivered document.
//
// The version rule is the same rule and it is enforced HERE rather than trusted from the
// ticks. The Files table deliberately lists superseded uploads, dimmed and badged `v2`, so an
// organizer can and will tick one. `promoteToLatest` answers that tick with the newest upload
// of the same thing, because the reference is explicit that "Previous versions cannot be
// included in a file" (docs/parity/external-references.md, "Bulk file download"), and the
// alternative reading, silently dropping the row, produces an archive missing a file the
// organizer watched themselves select.
//
// Everything here is pure, so it is unit tested (tests/bundle-file-selection.test.ts).

import {
  fileIdentity,
  latestVersionsOnly,
  type ScopeProblem,
  type VersionedFile,
} from '@/features/bundle/selection'

/**
 * The most files one bundle may cover.
 *
 * A different bound from MAX_BUNDLE_SESSIONS and for a different reason. That one is about
 * reads: a session selection costs one `Files` listing per session. This one costs a single
 * `listFilesForEventSpeakers` however many rows are ticked, so reads do not bound it. What
 * bounds it is the URL: the download is a GET a browser navigates to, it carries the included
 * ids, and 250 Airtable record ids is roughly 4.5 KB of query string, comfortably inside
 * Cloudflare's request-line limit with the origin and path in front of it.
 */
export const MAX_BUNDLE_FILES = 250

export type FileSelectionScope = {
  /** The ticked rows the event really holds, in the event's own read order. */
  readonly fileIds: readonly string[]
  /** Ticked ids the event does not contain. Dropped, and counted so the caller can say so. */
  readonly foreign: number
  readonly problem?: ScopeProblem
}

/**
 * Narrow a ticked selection to the files the event actually holds.
 *
 * The intersection is the security-relevant half, exactly as in `sessionScope`:
 * `eventFileIds` comes from a read already scoped to the event's speaker roster, so a file id
 * pasted in from another conference is simply not in the result and never reaches R2. It is
 * counted rather than silently dropped, because a selection that half-resolves should say so.
 */
export function fileSelectionScope(input: {
  eventFileIds: readonly string[]
  checkedIds: readonly string[]
}): FileSelectionScope {
  const checked = new Set(input.checkedIds)
  const fileIds = input.eventFileIds.filter((id) => checked.has(id))
  const resolved = new Set(fileIds)
  const foreign = new Set(input.checkedIds.filter((id) => !resolved.has(id))).size

  if (fileIds.length === 0) return { fileIds, foreign, problem: 'empty' }
  if (fileIds.length > MAX_BUNDLE_FILES) return { fileIds, foreign, problem: 'too-many' }
  return { fileIds, foreign }
}

/**
 * The latest version of everything the ticks touched, deduplicated.
 *
 * Two rows of one version group produce ONE member, and a tick on an old version resolves to
 * the newest upload of that group. `all` has to be every file the event holds rather than the
 * ticked subset: the newest upload of a group the organizer ticked at v1 is only findable if
 * it is in the input.
 *
 * Order follows `all`, which is the list's own order, so the archive reads the way the screen
 * the organizer ticked on did.
 */
export function promoteToLatest<T extends VersionedFile>(
  all: readonly T[],
  checkedIds: readonly string[],
): readonly T[] {
  const checked = new Set(checkedIds)
  const wanted = new Set(all.filter((file) => checked.has(file.id)).map(fileIdentity))
  return latestVersionsOnly(all).filter((file) => wanted.has(fileIdentity(file)))
}
