// Everything /admin/[eventId]/tasks renders, in one read.
//
// Six cached reads, run together: the event (for the timezone a due date is formatted in),
// the tasks, the assignments, the submissions, the forms, and the roster.
//
// `listSpeakers` used to be deliberately absent, on the argument that
// `SubmissionWithParticipants` already carries a resolved `Speaker` on every participant so
// the accepted cast comes free with the submissions read. That argument is right about the
// accepted cast and wrong about this page, and the difference is what the Onboarding status
// table is FOR. Two of the three ways a speaker gets a task have nothing to do with an
// acceptance: the by-hand picker assigns against `listSpeakers` (features/tasks/actions.ts,
// and roster-scope.ts documents why at length), and an imported or hand-added contact may
// have no submission at all. Scoping the progress table to `acceptedSpeakerScopes` meant a
// speaker who had just been given three tasks did not appear in it, so the table reported a
// roster as onboarded while somebody on it had three things outstanding.
//
// The `acceptedSpeakers` COUNT is a different question ("how many people would Assign to
// accepted target") and still comes from `acceptedSpeakerScopes`. Both are computed here.

import { type TaskCardView, type TaskTabView, taskTabs, toTaskCards } from '@/features/tasks/cards'
import { progressTotals, type SpeakerProgressRow, speakerProgress } from '@/features/tasks/progress'
import { chosenSpeakerScopes } from '@/features/tasks/roster-scope'
import { acceptedSpeakerScopes, type SpeakerScope } from '@/features/tasks/scope'
import {
  getEvent,
  listForms,
  listSpeakers,
  listSubmissions,
  listTaskAssignmentsForEvent,
  listTasksForEvent,
} from '@/services/airtable/queries'
import type { RecordId, Speaker, SubmissionWithParticipants } from '@/types/domain'

/** The Form picker on the Add Task drawer needs a name and an id, and nothing else. */
export type TaskFormOption = { id: RecordId; name: string }

export type TasksAdminView = {
  cards: readonly TaskCardView[]
  tabs: readonly TaskTabView[]
  progress: readonly SpeakerProgressRow[]
  totals: ReturnType<typeof progressTotals>
  forms: readonly TaskFormOption[]
  /** How many people an Assign run would target right now. */
  acceptedSpeakers: number
}

export async function loadTasksAdminView(eventId: RecordId): Promise<TasksAdminView> {
  const [event, tasks, items, submissions, forms, speakers] = await Promise.all([
    getEvent(eventId),
    listTasksForEvent(eventId),
    listTaskAssignmentsForEvent(eventId),
    listSubmissions(eventId),
    listForms(eventId),
    listSpeakers(eventId),
  ])

  const accepted = acceptedSpeakerScopes(submissions)
  const progress = speakerProgress({
    scopes: rosterScopes({ speakers, submissions, accepted }),
    items,
  })
  const cards = toTaskCards({ tasks, items, forms, timeZone: event.timezone })

  return {
    cards,
    tabs: taskTabs(cards),
    progress,
    totals: progressTotals(progress),
    forms: forms.map((form) => ({ id: form.id, name: form.name })),
    acceptedSpeakers: accepted.length,
  }
}

/**
 * One scope per person the Onboarding status table has to be able to show.
 *
 * The roster first, through the same `chosenSpeakerScopes` the by-hand Assign path uses, so
 * a row in this table and a row in that picker agree about who exists and about which
 * submissions a submission-scoped task would land on.
 *
 * Then the accepted cast appended for anyone the roster read did not return. The two lists
 * are scoped differently and neither contains the other by construction: `listSpeakers`
 * filters on the `events` link on the Speakers row, while the accepted cast comes off the
 * participant rows of accepted submissions, so a co-presenter whose Speakers record was
 * never linked to the event is accepted without being on the roster. Before this table
 * covered the roster that person was its only inhabitant; dropping them now to widen it
 * would trade one blind spot for another.
 *
 * Exported for tests/tasks-admin-scope.test.ts: it is the pure half of this module, and the
 * defect it fixes is invisible in `speakerProgress`, which faithfully renders whatever scopes
 * it is handed.
 */
export function rosterScopes(input: {
  speakers: readonly Speaker[]
  submissions: readonly SubmissionWithParticipants[]
  accepted: readonly SpeakerScope[]
}): readonly SpeakerScope[] {
  const roster = chosenSpeakerScopes({
    speakers: input.speakers,
    submissions: input.submissions,
    speakerIds: input.speakers.map((speaker) => speaker.id),
  }).scopes
  const onRoster = new Set(roster.map((scope) => scope.speaker.id))

  return [...roster, ...input.accepted.filter((scope) => !onRoster.has(scope.speaker.id))]
}
