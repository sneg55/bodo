// Turning ticked FILE REQUESTS into the files a bundle can actually hold.
//
// A file request is not a file, and that gap is the whole reason this module exists. An
// organizer on /admin/[eventId]/file-requests ticks "Signed release form" and "Headshot" and
// presses EXPORT; what those two rows name is an OBLIGATION, and any number of speakers may
// not have met it yet. Three chains have to be walked to get from one to the other:
//
//   FileRequests.id -> FileRequestAssignments.fileRequestId -> Files.fileRequestAssignmentId
//
// and every link can be empty. A request nobody has been assigned yet has no assignments; an
// assigned request nobody has answered has no files.
//
// The rule this module encodes: an unfulfilled request is EXCLUDED and COUNTED BY NAME, never
// silently dropped. An organizer who ticks seven rows and receives an archive of four files
// has no way to tell whether three were undelivered or whether the export lost them, and
// those two need very different responses from them. The names come back so the dialog can
// print them rather than just a number.
//
// Pure, so it is unit tested (tests/bundle-request-selection.test.ts). Nothing here reads
// Airtable; ./request-reads supplies the four lists.

import type { ScopeProblem } from '@/features/bundle/selection'

/**
 * The most file requests one export may cover.
 *
 * Far above any plausible tick set (an event has a handful of request definitions, not
 * hundreds), so this is a guard against a scripted caller rather than a limit an organizer
 * will meet. The bound that actually bites is MAX_BUNDLE_FILES, applied downstream once these
 * requests have resolved to files.
 */
export const MAX_BUNDLE_REQUESTS = 100

/** What the plan needs to know about one request. A projection of `FileRequest`. */
export type PlannableRequest = { readonly id: string; readonly title: string }

/** What it needs about one assignment: which request it answers, and its own id. */
export type PlannableAssignment = { readonly id: string; readonly fileRequestId: string }

/** What it needs about one stored file: its id, and the assignment it was delivered against. */
export type PlannableDelivery = {
  readonly id: string
  readonly fileRequestAssignmentId?: string
}

export type RequestBundlePlan = {
  /** Every file delivered against the ticked requests, before the latest-version rule. */
  readonly fileIds: readonly string[]
  /** Ticked requests with at least one delivered file. */
  readonly fulfilled: number
  /**
   * Ticked requests nobody has delivered, by title, in the event's own request order.
   *
   * By title rather than by id because this ends up in a sentence an organizer reads, and
   * "3 requests were skipped" sends them looking through the board to work out which.
   */
  readonly unfulfilledTitles: readonly string[]
  /** Ticked ids the event does not contain. Dropped, and counted so a stale tick is visible. */
  readonly foreign: number
  readonly problem?: ScopeProblem
}

/**
 * Walk requests to assignments to files, keeping the unmet obligations in view.
 *
 * `eventRequests` is the security-relevant input, exactly as `eventSessionIds` is in
 * `sessionScope`: it comes from `listFileRequests(eventId)`, so a request id from another
 * conference is not in it and contributes nothing. The assignments are already event-joined
 * upstream (`fileRequestItems` drops any whose request is not this event's), and the files
 * are read against this event's speaker roster, so no link in the chain can widen the scope
 * past what the first one allowed.
 */
export function requestBundlePlan(input: {
  eventRequests: readonly PlannableRequest[]
  checkedRequestIds: readonly string[]
  assignments: readonly PlannableAssignment[]
  files: readonly PlannableDelivery[]
}): RequestBundlePlan {
  const checked = new Set(input.checkedRequestIds)
  const requests = input.eventRequests.filter((request) => checked.has(request.id))
  const resolved = new Set(requests.map((request) => request.id))
  const foreign = new Set(input.checkedRequestIds.filter((id) => !resolved.has(id))).size

  if (requests.length === 0) {
    return { fileIds: [], fulfilled: 0, unfulfilledTitles: [], foreign, problem: 'empty' }
  }
  if (requests.length > MAX_BUNDLE_REQUESTS) {
    return { fileIds: [], fulfilled: 0, unfulfilledTitles: [], foreign, problem: 'too-many' }
  }

  // Assignment id -> the request it answers, restricted to the ticked ones. A request with no
  // assignments simply contributes no entries, which is what makes it unfulfilled below.
  const requestByAssignment = new Map<string, string>()
  for (const assignment of input.assignments) {
    if (resolved.has(assignment.fileRequestId)) {
      requestByAssignment.set(assignment.id, assignment.fileRequestId)
    }
  }

  const fileIds: string[] = []
  const answered = new Set<string>()
  for (const file of input.files) {
    if (file.fileRequestAssignmentId === undefined) continue
    const requestId = requestByAssignment.get(file.fileRequestAssignmentId)
    if (requestId === undefined) continue
    fileIds.push(file.id)
    answered.add(requestId)
  }

  return {
    fileIds,
    fulfilled: answered.size,
    // Event order, not tick order, so two organizers ticking the same rows read the same
    // sentence.
    unfulfilledTitles: requests
      .filter((request) => !answered.has(request.id))
      .map((request) => request.title),
    foreign,
  }
}

const TITLES_SHOWN = 3

/**
 * The sentence the dialog prints above the file list, or nothing when every ticked request
 * was delivered.
 *
 * Named titles rather than a bare count, capped so a tick of forty rows does not produce a
 * paragraph. The same `and N more` shape the delivery table's missing column already uses.
 */
export function unfulfilledNotice(plan: RequestBundlePlan): string | undefined {
  const missing = plan.unfulfilledTitles.length
  if (missing === 0) return undefined

  const shown = plan.unfulfilledTitles.slice(0, TITLES_SHOWN).join(', ')
  const rest = missing - TITLES_SHOWN
  const named = rest > 0 ? `${shown} and ${String(rest)} more` : shown
  const noun = missing === 1 ? 'request has' : 'requests have'

  return `${String(missing)} selected file ${noun} no upload yet, so nothing from ${missing === 1 ? 'it' : 'them'} is in this archive: ${named}.`
}
