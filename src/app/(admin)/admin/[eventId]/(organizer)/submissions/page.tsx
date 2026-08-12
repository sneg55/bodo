// /admin/[eventId]/submissions
//
// "View All", the first entry under SUBMISSIONS in the sidebar (ref 19). Every abstract
// and every session, unsplit, which is what View All means.
//
// It was a `/placeholder/submissions` card reading "not part of this build" while the
// table behind it already shipped: bodo models abstracts and sessions as one record type
// (docs/sessionboard-parity-report.md), so this surface was built the day Abstracts was.
// Everything here lives in `loadSubmissionsSurface` and `AbstractsTable`, one scope over.

import { requireEventId } from '@/features/events/resolve-ref'
import type { RawSearchParams } from '@/features/review/abstracts-query'
import { loadSubmissionsSurface } from '@/features/review/submissions-page'

import { AbstractsTable } from '../abstracts/AbstractsTable'

export default async function AllSubmissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>
  searchParams: Promise<RawSearchParams>
}) {
  const [{ eventId: eventRef }, rawSearchParams] = await Promise.all([params, searchParams])
  const eventId = await requireEventId(eventRef)

  const props = await loadSubmissionsSurface({
    eventId,
    searchParams: rawSearchParams,
    scope: 'all',
  })
  if (props === undefined) return null

  return <AbstractsTable {...props} />
}
