// Everything /admin/[eventId]/file-requests renders, in one read.
//
// Four cached reads, run together: the event (for the timezone a due date is formatted in),
// the requests, the assignments against them, and the submissions. The submissions are what
// decide who is accepted, so this surface cannot be built out of the two request tables alone.
//
// `listSpeakers` is deliberately not among them, for the reason the tasks view gives:
// `SubmissionWithParticipants` carries the resolved `Speaker` on every participant, so the
// accepted roster is already in the submissions read, and a fifth request would subscribe this
// page to `event:{id}:speakers` for data it already holds.

import {
  type RequestCardView,
  type RequestTabView,
  requestTabs,
  toRequestCards,
} from '@/features/file-requests/cards'
import { type DeliveryRow, deliveryRows, deliveryTotals } from '@/features/file-requests/delivery'
import { acceptedSpeakerScopes } from '@/features/tasks/scope'
import {
  getEvent,
  listFileRequestAssignmentsForEvent,
  listFileRequests,
  listSubmissions,
} from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'

export type FileRequestsAdminView = {
  cards: readonly RequestCardView[]
  tabs: readonly RequestTabView[]
  delivery: readonly DeliveryRow[]
  totals: ReturnType<typeof deliveryTotals>
  /** How many people an Assign run would target right now. */
  acceptedSpeakers: number
}

export async function loadFileRequestsAdminView(eventId: RecordId): Promise<FileRequestsAdminView> {
  const [event, requests, items, submissions] = await Promise.all([
    getEvent(eventId),
    listFileRequests(eventId),
    listFileRequestAssignmentsForEvent(eventId),
    listSubmissions(eventId),
  ])

  const scopes = acceptedSpeakerScopes(submissions)
  const delivery = deliveryRows({
    scopes,
    items,
    // So a per-session request names its session in the missing list. See `titleOf`.
    codeBySubmission: new Map(submissions.map((row) => [row.id, row.code])),
  })
  const cards = toRequestCards({ requests, items, timeZone: event.timezone })

  return {
    cards,
    tabs: requestTabs(cards),
    delivery,
    totals: deliveryTotals(delivery),
    acceptedSpeakers: scopes.length,
  }
}
