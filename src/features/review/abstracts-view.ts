// One function the Abstracts page calls: read, project, count, filter, sort, slice.
//
// Everything it reads is a cached, tagged DAL function, so a tab change or a page turn
// is served from the cache and no navigation waits on Airtable (BUILD_SPEC 6). The reads
// run concurrently because none of them depends on another's result.

import type { DataTableTab } from '@/components/primitives/data-table-types'
import {
  abstractTabs,
  filterAbstractRows,
  pageAbstractRows,
  sortAbstractRows,
} from '@/features/review/abstracts-filter'
import type { AbstractsQueryState } from '@/features/review/abstracts-query'
import { type AbstractRow, buildAbstractRows } from '@/features/review/abstracts-rows'
import { aiReviewerOrNone } from '@/features/review/ai-reviewer'
import { ratingsBySubmission } from '@/features/review/ratings'
import { listReviewsForEvent } from '@/features/review/review-reads'
import { filterScope, type SubmissionScope, scopeCopy } from '@/features/review/submission-scope'
import {
  getActivePlan,
  getEvent,
  listForms,
  listRooms,
  listRoundsForActivePlan,
  listSubmissions,
  listTags,
  listTracks,
} from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'

export type TrackOption = { readonly id: RecordId; readonly name: string }

export type AbstractsView = {
  /** The current page only. The tab counts below cover the whole event. */
  readonly rows: readonly AbstractRow[]
  readonly totalRows: number
  readonly page: number
  readonly tabs: readonly DataTableTab[]
  readonly tracks: readonly TrackOption[]
  /**
   * The Ratings column header. The audit found it as "Ratings: My Evaluation Plan", so
   * the plan is named in the column rather than left implicit: an event can have more
   * than one plan in the schema, and the label is what says which one you are looking at.
   */
  readonly ratingsLabel: string
  /**
   * The event's zone, which is the zone every date on this surface means.
   *
   * The rows are already formatted in it below, so this is for the controls that are not
   * rows: the Add Abstract drawer's date-time picker, and the export's filename. Carried
   * on the view rather than read again at each of them, because a second `getEvent` is a
   * second thing that can disagree about what "today" is.
   */
  readonly timeZone: string
}

export async function loadAbstractsView(
  eventId: RecordId,
  query: AbstractsQueryState,
  /**
   * Which of the three SUBMISSIONS surfaces is asking. One read serves all three: they are
   * the same table split on `reviewRequired` (submission-scope.ts), so scoping here costs
   * no extra request and every tag this page subscribes to is unchanged.
   */
  scope: SubmissionScope = 'abstracts',
): Promise<AbstractsView> {
  const [event, submissions, tracks, tags, rooms, forms, reviews, plan, rounds, aiReviewerId] =
    await Promise.all([
      getEvent(eventId),
      listSubmissions(eventId),
      listTracks(eventId),
      listTags(eventId),
      listRooms(eventId),
      listForms(eventId),
      listReviewsForEvent(eventId),
      getActivePlan(eventId),
      listRoundsForActivePlan(eventId),
      // Absent on a base that has never been seeded for the pre-screen, which is the
      // normal state of most deployments and not an error worth failing the table over.
      // Only that one failure is forgiven: a rate limit or an unreachable base rethrows
      // and takes the table with it, because the alternative is the Ratings column below
      // averaging the machine in with the committee and saying nothing (ai-reviewer.ts).
      aiReviewerOrNone(),
    ])

  // The Ratings column reports the plan, which is what its header says, and per row it
  // reports the furthest round that submission has been reviewed in (`aggregateRoundFor`).
  //
  // It used to be pinned to the plan's FIRST round for every row, on the argument that a
  // later round holds only the subset that advanced, so scoring the column on it would show
  // a dash for most of the table. Choosing per row keeps that property (a submission nobody
  // has advanced still reports the first round) and drops the defect it came with: an
  // organizer could run a whole second round and watch this column never move.

  const all = buildAbstractRows(submissions, {
    tracks,
    tags,
    rooms,
    forms,
    // The AI reviewer is named here, not just on the Evaluation surface. BUILD_SPEC 5.4
    // keeps a pre-screen out of the human average by default, and `ratingsBySubmission`
    // excludes nothing when it is not told who the AI is, so a loader that omitted this
    // showed the machine's scores in the organizer's own Ratings column. There is no
    // `includeAi` here on purpose: this column IS the committee's opinion.
    ratings: ratingsBySubmission({
      submissions,
      reviews,
      rounds,
      aiReviewerIds: aiReviewerId === undefined ? undefined : new Set([aiReviewerId]),
    }),
    timeZone: event.timezone,
  })

  // Scoped before anything else, so the tab badges below count this surface and not the
  // event. Everything downstream, including the export the Options menu builds from the
  // same query, therefore sees one surface's rows.
  const rows = filterScope(all, scope)

  const matched = sortAbstractRows(filterAbstractRows(rows, query), query.sort)
  const paged = pageAbstractRows(matched, query.page, query.pageSize)

  return {
    rows: paged.rows,
    totalRows: paged.totalRows,
    page: paged.page,
    tabs: abstractTabs(rows, scopeCopy(scope).allTabLabel),
    tracks: tracks.map((track) => ({ id: track.id, name: track.name })),
    ratingsLabel: plan === undefined ? 'Ratings' : `Ratings: ${plan.name}`,
    timeZone: event.timezone,
  }
}
