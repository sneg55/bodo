// The read behind EXPORT on the File Requests board.
//
// It resolves ticked REQUESTS to files and then hands those file ids to
// `loadFileBundleCandidates`, rather than building candidates itself. That delegation is the
// point rather than laziness: the latest-version promotion, the event-scope intersection, the
// session and speaker labels and the dialog's opt-outs then all come from one implementation,
// so an archive exported from the File Requests board and the same files exported from
// PORTALS > Files are byte for byte the same archive. A second candidate builder here is how
// the two would drift.
//
// What it costs is that `listSpeakers` and `listFilesForEventSpeakers` are asked for twice, by
// this function and again inside the delegate. Both are tagged, cached fetches with the same
// arguments (`read-cache.ts`), so the second ask is a cache hit rather than a second Airtable
// listing. Stated here rather than discovered later.
//
// EVENT SCOPE is enforced three times over and each one rules out something different:
// `listFileRequests(eventId)` bounds which requests may be ticked, `fileRequestItems` upstream
// has already dropped assignments belonging to another event's requests, and
// `listFilesForEventSpeakers` is bounded by this event's roster.

import { loadFileBundleCandidates } from '@/features/bundle/file-reads'
import type { BundleCandidate } from '@/features/bundle/reads'
import {
  type RequestBundlePlan,
  requestBundlePlan,
  unfulfilledNotice,
} from '@/features/bundle/request-selection'
import {
  listFileRequestAssignmentsForEvent,
  listFileRequests,
  listFilesForEventSpeakers,
  listSpeakers,
} from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'

export type RequestBundleCandidates = {
  readonly plan: RequestBundlePlan
  readonly files: readonly BundleCandidate[]
  readonly speakerIds: readonly string[]
  /** The sentence naming the ticked requests nobody has delivered, if there are any. */
  readonly notice?: string
}

/**
 * Candidate files for a ticked selection of file requests.
 *
 * An empty resolution is NOT an error here. Ticking two requests nobody has answered is a
 * perfectly ordinary thing to do on a board whose whole purpose is chasing people who have
 * not answered, so it comes back as a plan with no files and a notice naming them, and the
 * dialog is what decides that there is nothing to download.
 */
export async function loadRequestBundleCandidates(input: {
  eventId: RecordId
  checkedRequestIds: readonly string[]
  deselectedFileIds?: readonly string[]
}): Promise<RequestBundleCandidates> {
  const [requests, items, speakers] = await Promise.all([
    listFileRequests(input.eventId),
    listFileRequestAssignmentsForEvent(input.eventId),
    listSpeakers(input.eventId),
  ])

  const files = await listFilesForEventSpeakers(
    input.eventId,
    speakers.map((speaker) => speaker.id),
  )

  const plan = requestBundlePlan({
    eventRequests: requests,
    checkedRequestIds: input.checkedRequestIds,
    assignments: items.map((item) => item.assignment),
    files,
  })

  const notice = unfulfilledNotice(plan)
  if (plan.problem !== undefined || plan.fileIds.length === 0) {
    return {
      plan,
      files: [],
      speakerIds: speakers.map((speaker) => speaker.id),
      ...(notice === undefined ? {} : { notice }),
    }
  }

  const candidates = await loadFileBundleCandidates({
    eventId: input.eventId,
    checkedFileIds: plan.fileIds,
    ...(input.deselectedFileIds === undefined
      ? {}
      : { deselectedFileIds: input.deselectedFileIds }),
  })

  return {
    plan,
    files: candidates.files,
    speakerIds: candidates.speakerIds,
    ...(notice === undefined ? {} : { notice }),
  }
}
