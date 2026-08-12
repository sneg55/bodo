'use server'

// Export the current view as CSV, and export the review results.
//
// Two exports, deliberately not one. The Abstracts one below renders the table's own
// visible columns; the review results one renders per-criterion review detail, which can
// never be a table column because criteria are per-round and organizer-authored.
// `review-results.ts` opens with the full argument.
//
// A Server Action returning a string rather than a Route Handler streaming a file: the
// export is small (a conference base is thousands of rows, not millions), it needs the
// same `requireEventRole` check as everything else on this surface, and going through the
// action means the browser already has a session rather than needing a signed URL.
//
// It re-runs the same reads the table just did, so an export normally costs no Airtable
// requests: every read under `loadAbstractsView` goes through the Airtable client, which
// is where the tagged, cached fetches live now that Cache Components is off.

import { requireEventRole } from '@/features/auth/wiring'
import { slugify } from '@/features/resources/slug'
import { abstractsToCsv, csvFilename, toCsv } from '@/features/review/abstracts-csv'
import type { AbstractsQueryState } from '@/features/review/abstracts-query'
import { loadAbstractsView } from '@/features/review/abstracts-view'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { aiReviewerOrNone } from '@/features/review/ai-reviewer'
import {
  listAssignmentsForEvent,
  listEventReviewers,
  listReviewsForEvent,
} from '@/features/review/review-reads'
import { reviewResultsTable } from '@/features/review/review-results'
import { reviewerDisplayName } from '@/features/review/reviewer-progress'
import type { SubmissionScope } from '@/features/review/submission-scope'
import { getEvent, listRoundsForActivePlan, listSubmissions } from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'
import { AI_REVIEWER_NAME } from '@/types/prescreen'

/**
 * Big enough to hold any conference's abstract list in one page, which is how the export
 * gets "the current view" rather than "the page you are looking at". Airtable's own
 * pagination is already handled inside the DAL, so this only bounds the slice.
 */
const EXPORT_PAGE_SIZE = 100_000

export async function exportAbstractsCsvAction(input: {
  eventId: RecordId
  query: AbstractsQueryState
  columnKeys: readonly string[]
  /** Which of the three SUBMISSIONS surfaces is exporting. The file is named after it. */
  scope?: SubmissionScope
}): Promise<ActionResult<{ filename: string; csv: string }>> {
  try {
    await requireEventRole(input.eventId, 'reviewer')

    const scope = input.scope ?? 'abstracts'
    const view = await loadAbstractsView(
      input.eventId,
      {
        ...input.query,
        page: 1,
        pageSize: EXPORT_PAGE_SIZE,
      },
      scope,
    )

    return actionOk({
      // "abstracts", "sessions" or "submissions": an export that says which surface it
      // came off is the difference between two files in a downloads folder.
      //
      // Dated in the event's zone, which is the view's own: the file used to be named off
      // the UTC instant, so an export taken on a Sunday evening in Los Angeles came out
      // dated Monday under a page header reading SUNDAY.
      filename: csvFilename(
        scope === 'all' ? 'submissions' : scope,
        new Date().toISOString(),
        view.timeZone,
      ),
      csv: abstractsToCsv(view.rows, input.columnKeys, view.ratingsLabel),
    })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * The review results file: one row per submission, every reviewer's answer to every
 * criterion, their recommendation, and where the submission stands in review.
 *
 * ADMIN, not `reviewer`, and that is the one place this export's authorization differs from
 * the Abstracts one. That file shows the committee's aggregate; this one attributes every
 * verdict to the person who gave it, which is the chair's view of their own committee and
 * not something a fellow reviewer is entitled to read off a colleague.
 */
export async function exportReviewResultsCsvAction(input: {
  eventId: RecordId
  /** The round to report on. Defaults to the plan's first, as the Ratings column does. */
  roundId?: RecordId
}): Promise<ActionResult<{ filename: string; csv: string }>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const [event, submissions, reviews, assignments, reviewers, rounds, aiReviewerId] =
      await Promise.all([
        getEvent(input.eventId),
        listSubmissions(input.eventId),
        listReviewsForEvent(input.eventId),
        listAssignmentsForEvent(input.eventId),
        listEventReviewers(input.eventId),
        listRoundsForActivePlan(input.eventId),
        // Same forgiveness as `loadAbstractsView`: a base that was never seeded for the
        // pre-screen has no AI reviewer, and that is the normal state, not a failure.
        aiReviewerOrNone(),
      ])

    const ordered = [...rounds].sort((left, right) => left.order - right.order)
    const round = ordered.find((candidate) => candidate.id === input.roundId) ?? ordered.at(0)
    const roundSlug = round === undefined ? '' : slugify(round.name)
    // Scoped to the round being reported on, so a submission that advanced does not carry
    // the screening round's verdicts into the final round's column set.
    const inRound = reviews.filter((review) => review.roundId === round?.id)

    return actionOk({
      // NAMED for the round it reports on. This file scores one round, the Abstracts table
      // scores the round each submission has reached, and a reader comparing the two had
      // nothing on either to say they were different questions: the same submission came
      // out 44% here and 25% there, and both were right.
      filename: csvFilename(
        // `slugify` answers with an empty string for a name that has no usable characters
        // (a round called `!!!`), which falls back to the unqualified prefix rather than to
        // `review-results--2026-08-11.csv`.
        roundSlug === '' ? 'review-results' : `review-results-${roundSlug}`,
        new Date().toISOString(),
        event.timezone,
      ),
      csv: toCsv(
        reviewResultsTable({
          submissions,
          reviews: inRound,
          assignments: assignments.filter((row) => row.roundId === round?.id),
          reviewerNames: new Map([
            ...reviewers.map((reviewer) => [reviewer.id, reviewerDisplayName(reviewer)] as const),
            // The pre-screen's author, named. It holds no `EventMemberships` row on purpose
            // (`AI_REVIEWER_EMAIL`: it authors reviews and must never be a principal), so
            // `listEventReviewers` does not return it and its rows came out of the file as
            // `Unknown reviewer (AI)`. Unknown is exactly what it is not.
            ...(aiReviewerId === undefined ? [] : [[aiReviewerId, AI_REVIEWER_NAME] as const]),
          ]),
          round,
          aiReviewerIds: aiReviewerId === undefined ? undefined : new Set([aiReviewerId]),
        }),
      ),
    })
  } catch (error) {
    return actionFailure(error)
  }
}
