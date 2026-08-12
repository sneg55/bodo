// One conversation per deliverable, not one per upload.
//
// THE DEFECT this exists to fix: a comment is STORED against a `Files` row, and every
// re-upload creates a new `Files` row (versions.ts), so a thread read back by file id
// emptied itself the moment the speaker did what it asked. Reproduced on the running app:
// "Draft deck - final version coming Friday." (Dara Nasser) was the whole thread on a file
// request, a second version was uploaded against the same request, and the portal then read
// "No comments yet. The organizers will leave notes here if they need a change." The
// organizer's Files table still held the note, on the superseded row, which is why the two
// sides disagreed rather than both going blank.
//
// SO THE KEY IS THE VERSION GROUP, whatever `versionGroupKey` calls one deliverable, which
// for a requested document is the request assignment. A conversation about a deliverable
// belongs to the deliverable and survives its revisions: "re-export this without the speaker
// notes" is a request that is ANSWERED by version 2 arriving, so version 2 is the last place
// it should disappear from.
//
// STORAGE IS UNCHANGED, and that is the decision worth recording. Re-keying `FileComments`
// onto the assignment would mean a column on a shared production base, would orphan every
// comment already written against a file id, and would throw away the one thing the file
// link is genuinely good for: WHICH version was being discussed. That is kept and surfaced
// instead, as `onVersion` on each threaded comment, so a reader can still see that the note
// was written about v1.
//
// Pure, and tested in tests/file-comment-threads.test.ts.

import { fileVersions, versionGroupKey } from '@/features/files/versions'
import type { StoredFile } from '@/types/domain'

/** A comment plus the 1-based version of the upload it was posted against. */
export type ThreadedComment<C> = C & { readonly onVersion: number }

/**
 * The thread for every file, keyed by file id.
 *
 * Two files in the same version group get the SAME thread, because they are two versions of
 * one deliverable. Oldest first, so the thread reads forwards: the request before the answer
 * to it, which is the order `listFileComments` already returns and this preserves.
 *
 * A comment whose file is not in `files` is dropped rather than guessed at. The callers pass
 * a set already scoped to one event or one speaker, so a comment outside it is a file this
 * reader is not entitled to see, and attaching it to some other thread would leak it.
 */
export function fileCommentThreads<C extends { readonly fileId: string; readonly at: string }>(
  files: readonly StoredFile[],
  comments: readonly C[],
): ReadonlyMap<string, readonly ThreadedComment<C>[]> {
  const versions = fileVersions(files)
  const groupByFile = new Map(files.map((file) => [file.id, versionGroupKey(file)]))

  const byGroup = new Map<string, ThreadedComment<C>[]>()
  for (const comment of comments) {
    const group = groupByFile.get(comment.fileId)
    if (group === undefined) continue

    const threaded: ThreadedComment<C> = {
      ...comment,
      onVersion: versions.get(comment.fileId)?.version ?? 1,
    }
    const held = byGroup.get(group)
    if (held === undefined) byGroup.set(group, [threaded])
    else held.push(threaded)
  }

  // Sorted on the timestamp alone. Two comments written in the same second keep the order
  // they arrived in, because `Array.prototype.sort` is stable and the input is already
  // oldest first: a tiebreak on the file id would reorder a same-second exchange by record
  // id, which is meaningless to a reader.
  for (const thread of byGroup.values()) {
    thread.sort((left, right) => left.at.localeCompare(right.at))
  }

  const byFile = new Map<string, readonly ThreadedComment<C>[]>()
  for (const file of files) {
    byFile.set(file.id, byGroup.get(versionGroupKey(file)) ?? [])
  }
  return byFile
}
