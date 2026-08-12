// What goes into the bundle: the scope, the latest version only, and the modal's opt-outs.
//
// Every rule here comes from `docs/parity/external-references.md`, "Bulk file download",
// which is the reference of record for this feature and settles what our own audit recorded
// as unknown:
//
//   - "Scope is the checked selection", not all rows and not the filtered set. So an empty
//     tick set is a refusal rather than an implicit "everything", which is the whole reason
//     `sessionScope` reports `empty` instead of returning the event.
//   - "individual files can be deselected" inside the modal. That is `withoutDeselected`.
//   - "Previous versions cannot be included in a file and must be downloaded directly from
//     the session content tab." That is `latestVersionsOnly`, and it is the rule most
//     likely to look like it works while quietly shipping four copies of one deck.
//
// Nothing here reads Airtable or the clock, so all of it is unit tested
// (tests/bundle-selection.test.ts).

/**
 * The most sessions one bundle may cover.
 *
 * There is a stated cap in the reference for the sibling flow ("capped at 100 headshots at
 * a time"), so a cap is in keeping rather than invented. This one is lower for a reason
 * specific to this DAL: there is no event-scoped Files read, so the candidate list costs
 * one `Files` listing per selected session (see ./reads). Fifty is what keeps that inside
 * the rate budget BUILD_SPEC 3.1 sets.
 */
export const MAX_BUNDLE_SESSIONS = 50

export type ScopeProblem = 'empty' | 'too-many'

export type SessionScope = {
  /** The checked sessions that really belong to the event, in the event's own order. */
  readonly sessionIds: readonly string[]
  /** Checked ids the event does not contain. Dropped, and counted so the caller can say so. */
  readonly foreign: number
  readonly problem?: ScopeProblem
}

/**
 * Narrow a checked selection to the sessions the event actually holds.
 *
 * The intersection is the security-relevant half: `eventSessionIds` comes from an
 * event-scoped read, so an id the caller invented or copied from another conference is
 * simply not in the result. It is counted rather than silently dropped, because a selection
 * that half-resolves should say so.
 */
export function sessionScope(input: {
  eventSessionIds: readonly string[]
  checkedIds: readonly string[]
}): SessionScope {
  const checked = new Set(input.checkedIds)
  const sessionIds = input.eventSessionIds.filter((id) => checked.has(id))
  const foreign = new Set(input.checkedIds.filter((id) => !sessionIds.includes(id))).size

  if (sessionIds.length === 0) return { sessionIds, foreign, problem: 'empty' }
  if (sessionIds.length > MAX_BUNDLE_SESSIONS) {
    return { sessionIds, foreign, problem: 'too-many' }
  }
  return { sessionIds, foreign }
}

/** The subset of `StoredFile` the version rule needs. Kept minimal so tests stay literal. */
export type VersionedFile = {
  readonly id: string
  readonly speakerId: string
  readonly submissionId?: string
  readonly fileRequestAssignmentId?: string
  readonly kind: string
  readonly filename: string
  readonly uploadedAt: string
}

/**
 * What counts as "the same file" across uploads.
 *
 * A file request is the strongest signal there is: the assignment IS the logical document,
 * so answering it twice is two versions of one thing whatever the second upload was called.
 * `portal-view.ts` already draws that line for the speaker's own view.
 *
 * Without one, identity is the filename inside its owner scope, case-insensitively, because
 * a re-upload from a browser carries the same name and `buildObjectKey` deliberately gives
 * it a fresh nonce so the old object survives. Owner scope includes the submission as well
 * as the speaker: the same `slides.pdf` attached to two sessions is two files, not two
 * versions.
 */
export function fileIdentity(file: VersionedFile): string {
  const assignment = file.fileRequestAssignmentId?.trim() ?? ''
  if (assignment !== '') return `assignment:${assignment}`
  return [
    'named',
    file.submissionId ?? '',
    file.speakerId,
    file.kind,
    file.filename.trim().toLowerCase(),
  ].join('|')
}

/**
 * Whether `candidate` is a newer version of the same file than `held`.
 *
 * The record id breaks a tie, and it has to break it somehow: two rows written in the same
 * batch share `uploadedAt` to the millisecond, and "whichever the read happened to return
 * first" makes the archive differ between two downloads of one selection.
 */
function isNewer(candidate: VersionedFile, held: VersionedFile): boolean {
  if (candidate.uploadedAt !== held.uploadedAt) return candidate.uploadedAt > held.uploadedAt
  return candidate.id > held.id
}

/**
 * One file per identity, the newest upload winning, in first-seen order.
 *
 * Input order is preserved rather than sorted, so the folder layout a caller builds on top
 * is stable and reads in whatever order the read returned.
 */
export function latestVersionsOnly<T extends VersionedFile>(files: readonly T[]): readonly T[] {
  const newest = new Map<string, T>()
  const order: string[] = []

  for (const file of files) {
    const identity = fileIdentity(file)
    const held = newest.get(identity)
    if (held === undefined) {
      order.push(identity)
      newest.set(identity, file)
      continue
    }
    if (isNewer(file, held)) newest.set(identity, file)
  }

  return order.flatMap((identity) => {
    const file = newest.get(identity)
    return file === undefined ? [] : [file]
  })
}

/**
 * Drop what the organizer unticked in the modal.
 *
 * A separate step from `latestVersionsOnly` on purpose, and in this order: the modal lists
 * latest versions, so an id it hands back always names a survivor. Deselecting first would
 * let an unticked older version promote its predecessor back into the archive.
 */
export function withoutDeselected<T extends { readonly id: string }>(
  files: readonly T[],
  deselectedFileIds: readonly string[],
): readonly T[] {
  if (deselectedFileIds.length === 0) return files
  const dropped = new Set(deselectedFileIds)
  return files.filter((file) => !dropped.has(file.id))
}
