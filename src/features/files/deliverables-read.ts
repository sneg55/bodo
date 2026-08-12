// The pair rows behind the Delivery status table, in one read.
//
// Three cached reads run together: the event (for the timezone a deadline is formatted in),
// the assignments joined to their requests, and the submissions, which are what decide who is
// accepted and what supply each session's `SESS-n` code.
//
// They are the SAME cached reads `loadFileRequestsAdminView` makes, with the same tags and the
// same windows, so the two loaders on this page issue one set of requests between them rather
// than two: caching lives in the Airtable client as tagged `fetch` calls
// (.claude/rules/bodo-conventions.md), and an identical request is one Data Cache entry. That
// is what lets this be a separate loader instead of a fifth field bolted onto the admin view,
// which matters because the reminder action needs exactly these rows and must not depend on
// anything the page renders.
//
// `listSpeakers` is deliberately not among them, for the reason the admin view gives: the
// accepted roster is already resolved on the submissions read.

import { type DeliverableRow, deliverableRows } from '@/features/files/deliverables'
import { acceptedSpeakerScopes } from '@/features/tasks/scope'
import {
  getEvent,
  listFileRequestAssignmentsForEvent,
  listSubmissions,
} from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'

export async function loadDeliverables(eventId: RecordId): Promise<readonly DeliverableRow[]> {
  const [event, items, submissions] = await Promise.all([
    getEvent(eventId),
    listFileRequestAssignmentsForEvent(eventId),
    listSubmissions(eventId),
  ])

  return deliverableRows({
    scopes: acceptedSpeakerScopes(submissions),
    items,
    timeZone: event.timezone,
    codeBySubmission: new Map(submissions.map((row) => [row.id, row.code])),
    // Read once per request, so every row on one render agrees about what is overdue.
    now: new Date().toISOString(),
  })
}
