// The Agenda sub-tab's four counts, over the submission list the event home already holds.
//
// Pure and over data already in hand, which is the whole reason this exists: the panel adds no
// DAL read and subscribes the tab to no tag it was not already subscribed to. Every field of
// `Submission` it touches (`status`, `startsAt`, `scheduleStatus`) is on the rows `loadHome`
// reads for the KPI tiles on every tab.
//
// **Two of the four counts are the advisory strip's own predicates**, deliberately reusing the
// exact conditions in `home-view.ts`: `awaitingSlot` is the strip's `unslotted` check and
// `awaitingPublication` is its `unpublished` check. The strip is on this tab too, so a panel
// that counted either of them differently would put two numbers for one question on one screen.
//
// Tested in tests/dashboard-agenda-readiness.test.ts, for the reason the rest of the home is:
// scheduling has two orthogonal axes (the review lifecycle and `ScheduleStatus`) and a count
// that quietly conflates them is an organizer chasing sessions that were never accepted.

import type { SubmissionWithParticipants } from '@/types/domain'

export type AgendaReadiness = {
  /** Accepted submissions, which is what a session on the agenda is made of. */
  accepted: number
  /** Accepted and holding a start time. */
  slotted: number
  /** Accepted with no start time. The strip's "still need a time slot" count. */
  awaitingSlot: number
  /** Scheduled but not yet exposed publicly. The strip's "not on the public agenda" count. */
  awaitingPublication: number
}

type ScheduledOf = Pick<SubmissionWithParticipants, 'status' | 'startsAt' | 'scheduleStatus'>

export function agendaReadiness(submissions: readonly ScheduledOf[]): AgendaReadiness {
  const accepted = submissions.filter((row) => row.status === 'accepted')

  return {
    accepted: accepted.length,
    slotted: accepted.filter((row) => row.startsAt !== undefined).length,
    awaitingSlot: accepted.filter((row) => row.startsAt === undefined).length,
    // Over every submission and not only the accepted ones, because that is what the strip
    // counts: `scheduleStatus` is set by the agenda builder, so a row carrying `scheduled` is
    // on somebody's grid whatever its review status says, and hiding it here would make the
    // panel disagree with the sentence above it.
    awaitingPublication: submissions.filter((row) => row.scheduleStatus === 'scheduled').length,
  }
}
