// The candidate files for a bundle selected ROW BY ROW on one of the two admin Files lists.
//
// The sibling of ./reads, and the same contract: one read composes the whole thing and both
// callers use it, the export dialog (so the organizer sees exactly what the archive will
// hold, and can untick from it) and the download route (so the archive is built from a fresh
// read rather than from anything the URL asserted). A dialog listing one set and a route
// streaming another is how a bundle silently gains or loses a file.
//
// It costs ONE `Files` listing however many rows are ticked, because `listFilesForEventSpeakers`
// exists now. That is the read /admin/[eventId]/files is already built on, so opening the
// dialog from that page hits a warm cache entry, and it is why this path has no fifty-row
// bound the way the session path does.
//
// EVENT SCOPE is the speaker roster, exactly as it is for the list itself: the `Files` table
// has no event link, so `listFilesForEventSpeakers` filters on the ids passed to it and on
// nothing else. Those ids come from `listSpeakers(eventId)` here and never from the request.
// The download route then checks each object key's owner against the same roster
// (./object-scope), which rules out a foreign OBJECT the way this rules out a foreign ROW.

import {
  type FileSelectionScope,
  fileSelectionScope,
  promoteToLatest,
} from '@/features/bundle/file-selection'
import {
  type BundleCandidate,
  eventSpeakerIds,
  sessionLabel,
  speakerName,
} from '@/features/bundle/reads'
import { withoutDeselected } from '@/features/bundle/selection'
import {
  listFilesForEventSpeakers,
  listSpeakers,
  listSubmissions,
} from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'

export type FileBundleCandidates = {
  readonly scope: FileSelectionScope
  readonly files: readonly BundleCandidate[]
  /** The event's own speaker ids, so the caller can scope object keys without re-reading. */
  readonly speakerIds: readonly string[]
}

/**
 * Candidate files for a ticked selection of file rows.
 *
 * The order of the three rules matters and it is the same order ./reads uses. Scope first, so
 * a foreign id is gone before anything else looks at it. Then `promoteToLatest`, which answers
 * a tick on a superseded row with the newest upload of the same thing. Then `withoutDeselected`
 * LAST, because the dialog lists survivors of the first two: unticking there is a statement
 * about what it showed, and applying it earlier would let an unticked old version promote its
 * own predecessor back into the archive.
 */
export async function loadFileBundleCandidates(input: {
  eventId: RecordId
  checkedFileIds: readonly string[]
  deselectedFileIds?: readonly string[]
}): Promise<FileBundleCandidates> {
  const [speakers, submissions] = await Promise.all([
    listSpeakers(input.eventId),
    listSubmissions(input.eventId),
  ])
  const speakerIds = eventSpeakerIds(submissions, speakers)

  const files = await listFilesForEventSpeakers(
    input.eventId,
    speakers.map((speaker) => speaker.id),
  )

  const scope = fileSelectionScope({
    eventFileIds: files.map((file) => file.id),
    checkedIds: input.checkedFileIds,
  })
  if (scope.problem !== undefined) return { scope, files: [], speakerIds }

  const sessionById = new Map(submissions.map((submission) => [submission.id, submission]))
  const nameById = new Map(speakers.map((speaker) => [speaker.id, speakerName(speaker)]))

  const candidates = promoteToLatest(files, scope.fileIds).map((file) => {
    const submission =
      file.submissionId === undefined ? undefined : sessionById.get(file.submissionId)
    return {
      id: file.id,
      objectKey: file.objectKey,
      filename: file.filename,
      size: file.size,
      kind: file.kind,
      speakerId: file.speakerId,
      // A portal file hangs off no session. Empty rather than a placeholder, because
      // `bundleEntryPaths` is what decides the folder for a file with no session label
      // ("Unassigned") and two modules naming that folder is how they come to disagree.
      sessionId: file.submissionId ?? '',
      sessionLabel: submission === undefined ? '' : sessionLabel(submission),
      speakerLabel: nameById.get(file.speakerId) ?? '',
    }
  })

  return {
    scope,
    files: withoutDeselected(candidates, input.deselectedFileIds ?? []),
    speakerIds,
  }
}
