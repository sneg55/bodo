// Which upload supersedes which.
//
// Re-uploading a deliverable has ALWAYS created a new `Files` row and never deleted the old
// one, so the version history has been in the base since uploads shipped. Nothing said so:
// every row rendered identically, in one flat list, and the only clue that a speaker had
// sent a corrected deck was two rows with the same name and different timestamps. An
// organizer reading that list could not tell which file to open.
//
// DERIVED rather than stored, and that is the decision worth recording. A `version` column
// would have to be computed at upload time from a read of the existing rows, which is a
// read-then-write with no transaction behind it: two uploads landing together would both
// see "1" and both write "2". Deriving from `uploadedAt` at read time cannot disagree with
// itself, costs nothing (the rows are already in hand), and repairs itself if a row is
// deleted in Airtable by somebody tidying up.

import type { StoredFile } from '@/types/domain'

/**
 * What makes two uploads versions of THE SAME thing.
 *
 * A file request is the strongest signal and takes precedence: an assignment is one
 * organizer asking one speaker for one document, so everything delivered against it is a
 * version of that document however the speaker named the file.
 *
 * Without a request, the grouping is the speaker, the session and the kind together. That is
 * deliberately coarser than filename: a speaker who uploads `deck.pdf` and then
 * `deck-final.pdf` against the same session has replaced their slides, and matching on name
 * would file them as two unrelated documents, which is the failure this exists to fix. It
 * is also deliberately NOT just the speaker: slides for one talk do not supersede slides for
 * another.
 */
export function versionGroupKey(file: StoredFile): string {
  if (file.fileRequestAssignmentId !== undefined) {
    return `request:${file.fileRequestAssignmentId}`
  }
  return `own:${file.speakerId}:${file.submissionId ?? 'none'}:${file.kind}`
}

export type FileVersion = {
  /** 1 for the first upload in its group, counting up. */
  readonly version: number
  /** True for the newest in the group: the one an organizer should open. */
  readonly isLatest: boolean
  /** How many uploads there are in total, so a row can say "2 of 3". */
  readonly groupSize: number
}

/**
 * Version facts for every file, keyed by id.
 *
 * Ordered by `uploadedAt` with the record id as a tiebreak, so two uploads written in the
 * same second still get a stable, total order rather than one that changes between reads.
 */
export function fileVersions(files: readonly StoredFile[]): ReadonlyMap<string, FileVersion> {
  const groups = new Map<string, StoredFile[]>()
  for (const file of files) {
    const key = versionGroupKey(file)
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [file])
    else group.push(file)
  }

  const versions = new Map<string, FileVersion>()
  for (const group of groups.values()) {
    const ordered = [...group].sort(
      (left, right) =>
        left.uploadedAt.localeCompare(right.uploadedAt) || left.id.localeCompare(right.id),
    )
    ordered.forEach((file, index) => {
      versions.set(file.id, {
        version: index + 1,
        isLatest: index === ordered.length - 1,
        groupSize: ordered.length,
      })
    })
  }
  return versions
}
