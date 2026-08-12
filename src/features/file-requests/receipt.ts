// What an upload satisfies, and whether that is a write at all.
//
// The upload path knows three things: who is uploading, which file request they say they are
// answering, and optionally which of their sessions it is for. Turning that into "this exact
// `FileRequestAssignments` row moves to received" is the decision that has to be right, so it
// is here, pure, rather than inline in the route handler where it could only be exercised by
// posting real bytes.
//
// Every branch below is a case that bites, and each is asserted in
// tests/file-requests-receipt.test.ts:
//
//   - A speaker with nothing requested of them is REFUSED rather than silently having a row
//     created. Creating one on upload would let anyone with a session invent an assignment,
//     and it would also mean an organizer's delivery table grew rows they never asked for.
//   - A submission-scoped request against a speaker with several accepted submissions needs to
//     know WHICH session, so it is refused as ambiguous rather than closing an arbitrary one.
//     With exactly one candidate the session is not ambiguous and no question is asked.
//   - A duplicate row for one tuple (Airtable has no unique constraint) resolves to ONE row,
//     deterministically, preferring one that is already received, so a second upload cannot
//     flip a second row and make the same document count twice.
//   - A file uploaded twice against one request is a no-op on the assignment: the first
//     `receivedAt` stands. The second file is still recorded, because two versions of a
//     document is a real thing that happened, but the row does not move again and nothing is
//     invalidated for it.

import type { FileRequestItem } from '@/services/airtable/reads-requests'
import type { RecordId } from '@/types/domain'

export type RequestTargetProblem = 'not-requested' | 'ambiguous-submission' | 'wrong-submission'

export type RequestTarget =
  | {
      ok: true
      item: FileRequestItem
      /** True when the row already carries a `receivedAt`, so the receipt is a no-op. */
      alreadyReceived: boolean
    }
  | { ok: false; problem: RequestTargetProblem; message: string }

/**
 * Which of a speaker's own assignments this upload answers.
 *
 * `items` MUST already be scoped to the acting speaker: this function decides which of their
 * rows is meant, not whether the rows are theirs. Ownership is the caller's, and the caller
 * (the upload route) gets the list from a speaker-scoped read, so a request id belonging to
 * somebody else's assignment simply is not in the set and falls out as `not-requested`.
 */
export function resolveRequestTarget(input: {
  items: readonly FileRequestItem[]
  fileRequestId: RecordId
  /** The submission the upload is filed against, when the caller resolved one. */
  submissionId?: RecordId
}): RequestTarget {
  const candidates = input.items.filter((item) => item.request.id === input.fileRequestId)
  if (candidates.length === 0) {
    return {
      ok: false,
      problem: 'not-requested',
      message: 'this file request is not open for you',
    }
  }

  // A contact- or group-scoped request has no submission on its rows, so a submission the
  // upload happens to carry is ignored rather than used to match: a speaker attaching their
  // headshot release while looking at a session page is still answering the contact request.
  const scoped = candidates.filter((item) => item.assignment.submissionId !== undefined)
  if (scoped.length === 0) return chosen(candidates)

  if (input.submissionId === undefined) {
    if (scoped.length === 1) return chosen(scoped)
    return {
      ok: false,
      problem: 'ambiguous-submission',
      message: 'this file request is per session: say which session the file is for',
    }
  }

  const matching = scoped.filter((item) => item.assignment.submissionId === input.submissionId)
  if (matching.length === 0) {
    return {
      ok: false,
      problem: 'wrong-submission',
      message: 'this file request is not open for that session',
    }
  }
  return chosen(matching)
}

/**
 * One row out of a set that describes the same document.
 *
 * A received row wins, so a second upload lands on the row that already carries the stamp
 * instead of flipping its duplicate; otherwise the lowest record id wins, which is arbitrary
 * but STABLE, so two concurrent uploads pick the same row rather than closing one each.
 */
function chosen(candidates: readonly FileRequestItem[]): RequestTarget {
  const ordered = [...candidates].sort((left, right) =>
    left.assignment.id.localeCompare(right.assignment.id),
  )
  // `.at(0)` rather than `[0]`, so the empty case is a value this function has to answer for
  // instead of a type the compiler was told to trust.
  const item =
    ordered.find((candidate) => candidate.assignment.status === 'received') ?? ordered.at(0)
  if (item === undefined) {
    // Unreachable: every caller above has checked the array is non-empty. Kept because the
    // alternative is a non-null assertion, and this file is the one place a wrong answer is
    // a document silently marked as delivered.
    return { ok: false, problem: 'not-requested', message: 'this file request is not open for you' }
  }

  return {
    ok: true,
    item,
    alreadyReceived:
      item.assignment.status === 'received' || item.assignment.receivedAt !== undefined,
  }
}

export type PlannedReceipt = {
  assignmentId: RecordId
  speakerId: RecordId
  submissionId?: RecordId
  receivedAt: string
}

/**
 * The receipt write, or nothing.
 *
 * `undefined` for a row that is already received, and that is not an optimisation: writing
 * again would move `receivedAt` to the second upload's clock, so the delivery table would
 * report the document as arriving later than it did, and it would expire three cache tags to
 * show a change nobody made.
 */
export function plannedReceipt(target: RequestTarget, nowIso: string): PlannedReceipt | undefined {
  if (!target.ok || target.alreadyReceived) return undefined
  return {
    assignmentId: target.item.assignment.id,
    speakerId: target.item.assignment.speakerId,
    submissionId: target.item.assignment.submissionId,
    receivedAt: nowIso,
  }
}
