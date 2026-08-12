// Resolve a submission by its user-facing code, for the acting speaker only.
//
// Split out of the portal Server Actions because the upload route needs exactly the
// same resolution and exactly the same refusal. Two copies of an ownership check is
// how one of them ends up subtly weaker, and this is the check that decides whether a
// speaker can attach a file to somebody else's session.
//
// The filter happens BEFORE the lookup, which is the part worth preserving: a code
// belonging to another speaker comes back as not-found rather than as a record handed
// to the guard. That way the failure cannot leak whether the code exists.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { assertOwnsSubmission, speakerSubject } from '@/features/portal/authorize'
import { portalEventIds } from '@/features/portal/event-scope'
import { ownSubmissions } from '@/features/portal/own-submissions'
import { listSubmissionsForEvents } from '@/services/airtable/queries'
import type { RecordId, SubmissionWithParticipants } from '@/types/domain'

/**
 * The caller's own submission with this code, or a refusal.
 *
 * `assertOwnsSubmission` runs even though the list is already filtered. That is not
 * redundancy for its own sake: the filter decides what the speaker can see and the
 * guard decides what they may act on, and BUILD_SPEC 4 is explicit that a mutation
 * authorizes for itself rather than trusting an earlier narrowing.
 *
 * The scope is the SPEAKER'S OWN EVENTS and it is resolved here rather than taken as an
 * argument. Every caller used to pass `portalEventId()`, so editing, uploading to, or
 * changing the roster of a submission filed to any other conference failed with
 * `DATA_RECORD_NOT_FOUND` on a record that existed and belonged to the person asking. It
 * is not merely a widened filter: `portalEventIds` is the authorization boundary, so a
 * code outside it still resolves to not-found rather than to a record the guard then has
 * to refuse.
 */
export async function resolveOwnSubmission(options: {
  speakerId: RecordId
  code: string
}): Promise<SubmissionWithParticipants> {
  const { speakerId, code } = options

  const scope = await portalEventIds(speakerId)
  const own = ownSubmissions(await listSubmissionsForEvents(scope), speakerId)
  const submission = own.find((row) => row.code === code)
  if (submission === undefined) {
    throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'no such submission for this speaker', {
      code,
    })
  }

  assertOwnsSubmission(speakerSubject(speakerId), submission)
  return submission
}
