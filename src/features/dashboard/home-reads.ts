// What the event home reads, and deliberately what each SUB-TAB does not.
//
// Composition over the DAL and nothing else: every call below is already tagged and cached
// where the fetch happens (read-cache.ts), so this file adds no caching of its own and must
// not.
//
// **Tag granularity is why the reads are per tab.** The sub-tabs are routes, so each one is
// its own request and gets to subscribe to only what it renders. Every tab needs the event
// record and the submission list (the kicker, the KPI tiles, the status tiles, the advisory
// strip). Only Submission Forms needs the form list and the tag names, and only Evaluations
// needs the review graph. Reading all five everywhere would subscribe the Participants tab to
// `event:{id}:forms`, `event:{id}:lookups`, `event:{id}:review` and `event:{id}:plan`, so
// renaming a track or saving one score would expire a panel that cannot show either. That is
// the same reasoning `features/portal-forms/reads.ts` gives for its deliberate third read.
//
// The review half is unchanged: five cached reads issued together, none of them new, and
// `listAssignmentsForReviewer` is still not among them because that read answers "assigned to
// me" and the card is a fact about the whole committee.

import { requireAdminUser } from '@/features/auth/wiring'
import {
  listAssignmentsForEvent,
  listEventReviewers,
  listReviewsForEvent,
} from '@/features/review/review-reads'
import {
  getActivePlan,
  getEvent,
  listForms,
  listRoundsForActivePlan,
  listSubmissions,
  listTags,
} from '@/services/airtable/queries'
import type { Event, RecordId, SubmissionWithParticipants, Tag } from '@/types/domain'
import type { Form } from '@/types/forms'

import { loadDashboardTabs } from './dashboard-reads'
import type { DashboardTab } from './dashboard-tabs'
import { type ReviewProgressView, reviewProgress } from './review-progress'
import type { HomeTab } from './sub-tabs'

export type HomeData = {
  event: Event
  /**
   * The dashboard TAB strip: `Today` plus this event's custom dashboards (ref 34).
   *
   * Read on every sub-tab, because the strip is on every sub-tab. It is one more cached read
   * running in parallel with the others, and it subscribes this page to
   * `event:{id}:dashboards`, which is the tag a new dashboard expires: the tab has to appear
   * the moment it is created or the strip is lying about what exists.
   */
  tabs: readonly DashboardTab[]
  submissions: readonly SubmissionWithParticipants[]
  /** Empty on the tabs that show no form: see the header. */
  forms: readonly Form[]
  tags: readonly Tag[]
  /** Present on the Evaluations tab only. */
  review?: ReviewProgressView
}

export async function loadHome(eventId: RecordId, tab: HomeTab): Promise<HomeData> {
  const wantsForms = tab === 'submission-forms'
  const [event, submissions, forms, tags, review, tabs] = await Promise.all([
    getEvent(eventId),
    listSubmissions(eventId),
    wantsForms ? listForms(eventId) : [],
    wantsForms ? listTags(eventId) : [],
    tab === 'evaluations' ? loadReviewProgress(eventId) : undefined,
    loadDashboardTabs(eventId),
  ])

  return {
    event,
    submissions,
    forms,
    tags,
    tabs,
    ...(review === undefined ? {} : { review }),
  }
}

export async function loadReviewProgress(eventId: RecordId): Promise<ReviewProgressView> {
  const [plan, rounds, assignments, reviews, reviewers] = await Promise.all([
    getActivePlan(eventId),
    listRoundsForActivePlan(eventId),
    listAssignmentsForEvent(eventId),
    listReviewsForEvent(eventId),
    listEventReviewers(eventId),
  ])

  return reviewProgress({ plan, rounds, assignments, reviews, reviewers })
}

/**
 * The signed-in organizer's first name, for ref 34's "Good morning, Sw".
 *
 * Resolved through `listEventReviewers`, which is everyone with a membership on THIS event
 * plus their AdminUsers row, rather than through a new per-user read. Two reasons, and the
 * second is the important one:
 *
 * - It is already cached under `event:{id}`, which this page reads anyway for the kicker, so
 *   the greeting subscribes to no tag the screen was not already subscribed to. A per-user
 *   read would have been a new tag nothing invalidates.
 * - It is the same read the Evaluations tab already issues for the reviewer rows, so on that
 *   tab the name costs nothing at all.
 *
 * It is still an Airtable round trip for a word, so the caller renders it inside a `<Suspense>`
 * boundary: the greeting paints immediately without the name and the name streams in. Nothing
 * here throws outward. A greeting is a nicety, and an unreadable one must not take a dashboard
 * to the error boundary, which is exactly what an exception inside a boundary would do.
 */
export async function currentUserFirstName(eventId: RecordId): Promise<string | undefined> {
  try {
    const [{ userId }, people] = await Promise.all([
      requireAdminUser(),
      listEventReviewers(eventId),
    ])
    const name = people.find((person) => person.id === userId)?.name.trim() ?? ''
    // First word only: `AdminUsers.name` is a full name, and ref 34 greets by first name.
    return name.length === 0 ? undefined : name.split(/\s+/u).at(0)
  } catch {
    return undefined
  }
}
