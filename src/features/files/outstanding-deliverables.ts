// Who still owes a DOCUMENT, and exactly which ones. CNT-08.
//
// The file-side twin of `features/comms/outstanding-tasks.ts`, and deliberately a twin rather
// than a generalization of it: that one walks TaskAssignments and this one walks the pair rows
// computed in deliverables.ts, and the two differ in what a row means (a task is done by the
// speaker, a request is satisfied by a verified file arriving) and in the words the message
// uses. Folding them together would produce one function with a `kind` flag and two vocabularies.
//
// A speaker with no address on file is DROPPED here rather than at the sender, for the reason
// the task version gives: they are not somebody who can be reminded, and leaving them in would
// make the confirmation count people who were never going to be mailed.
//
// Pure, and tested in tests/files-deliverables.test.ts.

import type { DeliverableRow } from '@/features/files/deliverables'
import type { RecordId } from '@/types/domain'

export type OutstandingDeliverable = {
  /** The request title with its session code, which is what the speaker will recognize. */
  readonly title: string
  /** `Due Mar 3, 2026`, in the event's timezone. Absent when the request has no deadline. */
  readonly dueLabel?: string
  readonly dueAt?: string
  readonly required: boolean
  readonly overdue: boolean
}

export type OutstandingFileSpeaker = {
  readonly speakerId: RecordId
  readonly name: string
  readonly email: string
  /** Never empty: a speaker who owes nothing is not in the list at all. */
  readonly deliverables: readonly OutstandingDeliverable[]
}

/**
 * One entry per speaker who still owes a document, in the order the rows arrive.
 *
 * `deliverableRows` already orders soonest deadline first with the undated last, so the list
 * inside each entry is the order the speaker will see in their own portal. Nothing re-sorts it
 * here, which is what keeps the two agreeing.
 */
export function outstandingDeliverableRows(
  rows: readonly DeliverableRow[],
): readonly OutstandingFileSpeaker[] {
  const bySpeaker = new Map<RecordId, OutstandingFileSpeaker>()

  for (const row of rows) {
    if (row.state === 'received') continue
    if (row.email.trim() === '') continue

    const existing = bySpeaker.get(row.speakerId)
    const entry: OutstandingDeliverable = {
      title: row.sessionCode === undefined ? row.title : `${row.title} (${row.sessionCode})`,
      ...(row.dueDate === undefined ? {} : { dueLabel: `Due ${row.dueDate}` }),
      ...(row.dueAt === undefined ? {} : { dueAt: row.dueAt }),
      required: row.required,
      overdue: row.state === 'overdue',
    }

    bySpeaker.set(row.speakerId, {
      speakerId: row.speakerId,
      name: row.speakerName,
      email: row.email.trim(),
      deliverables: [...(existing?.deliverables ?? []), entry],
    })
  }

  return [...bySpeaker.values()]
}

/**
 * The rows an organizer's selection actually targets.
 *
 * The ids are a FILTER, never a recipient list, for the reason `selectedOutstanding` gives: a
 * Server Action is reachable by POST with no page ever rendering, so recomputing who is behind
 * means the worst a forged call can do is send the reminder the organizer could have sent
 * anyway. An EMPTY selection means everybody who is behind, which is what the button on the
 * Delivery status header sends: that surface has just shown the organizer who those people are.
 */
export function selectedOutstandingFiles(
  rows: readonly OutstandingFileSpeaker[],
  speakerIds: readonly RecordId[],
): readonly OutstandingFileSpeaker[] {
  if (speakerIds.length === 0) return rows
  const picked = new Set(speakerIds)
  return rows.filter((row) => picked.has(row.speakerId))
}
