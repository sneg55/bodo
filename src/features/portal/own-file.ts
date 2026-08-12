// Resolving one stored object for the SPEAKER who is asking, so the portal can serve it.
//
// The admin route (`/api/files/<id>`) cannot answer this. It guards on
// `requireEventRole(eventId, 'reviewer')`, which a speaker never holds, so every private
// object in the portal had no link at all: the Files card rendered a `Private` badge and
// stopped, and a speaker could see that their deck had been stored and could not open it to
// check WHICH deck it was. That is the same hole the admin route was written to close, on
// the other side of the product.
//
// Scope, and it is the whole of the security here: a `Files` row records a speaker and
// never an event, so there is nothing on the file to check. What there is, is the set of
// files the acting speaker can legitimately reach, and this resolves the id INSIDE that set
// rather than fetching the row and then asking whether it is allowed. A file id is
// therefore not a bearer token, which is what lets the link live in an ordinary anchor.
//
// Two sets, because a speaker legitimately reaches two kinds of file:
//
//   - their own uploads, which is every row carrying their speaker id (headshots, delivered
//     file requests, their own slides);
//   - the files attached to a submission they are ON, which includes a CO-SPEAKER'S upload.
//     A co-presenter needs to open the deck their colleague filed, and `assertOwnsFile`
//     alone would refuse them, because that compares speaker ids and the co-speaker did not
//     upload it. `readOwnSubmissionByCode` already answers "is this submission yours", for
//     the submitter and the whole cast alike, so the submission-scoped path reuses it
//     instead of restating the rule.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireSpeaker } from '@/features/auth/wiring'
import { readOwnSubmissionByCode } from '@/features/portal/reads'
import { listFilesForSpeaker } from '@/services/airtable/queries'
import type { RecordId, StoredFile } from '@/types/domain'

/**
 * The file, if the acting speaker can reach it.
 *
 * `submissionCode` narrows the search to one submission's attachments and is what makes a
 * co-speaker's upload reachable. Omitted, the search is the caller's own uploads, which is
 * what a headshot or a delivered file request is.
 *
 * Not-found and not-yours are deliberately the same answer, the same call
 * `readOwnSubmissionByCode` makes: telling a speaker that a file id exists but belongs to
 * somebody else is a fact about another person's work.
 */
export async function getOwnFile(fileId: RecordId, submissionCode?: string): Promise<StoredFile> {
  const files = await reachableFiles(submissionCode)
  const file = files.find((candidate) => candidate.id === fileId)
  if (file === undefined) {
    throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that file is not yours', {
      fileId,
      submissionCode: submissionCode ?? '',
    })
  }
  return file
}

async function reachableFiles(submissionCode?: string): Promise<readonly StoredFile[]> {
  if (submissionCode === undefined || submissionCode.length === 0) {
    // `requireSpeaker` FIRST, so an unauthenticated caller never causes a listing.
    const { speakerId } = await requireSpeaker()
    return await listFilesForSpeaker(speakerId)
  }

  // This read calls `requireSpeaker` itself and filters the event's submissions to the
  // caller's own before resolving the code, so an unknown or foreign code answers
  // `undefined` rather than another speaker's attachments.
  const detail = await readOwnSubmissionByCode(submissionCode)
  return detail?.files ?? []
}
