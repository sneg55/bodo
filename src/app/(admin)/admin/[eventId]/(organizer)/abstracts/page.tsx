// /admin/[eventId]/abstracts
//
// One of three routes over the same table: `/submissions` (View All), this one, and
// `/sessions`. The read, the saved-view resolution and the role check are
// `loadSubmissionsSurface`; the scope is the only thing this file decides.
//
// One file, not a static shell plus an `AbstractsBody` child inside `<Suspense>`. That
// split existed only because `cacheComponents` refused a page body that awaited `params`
// or `searchParams`. `loading.tsx` renders the same `AbstractsSkeleton` this page used as
// a fallback, so the visitor sees exactly what they saw before while the table loads.

import { requireEventId } from '@/features/events/resolve-ref'
import type { RawSearchParams } from '@/features/review/abstracts-query'
import { loadSubmissionsSurface } from '@/features/review/submissions-page'

import { AbstractsTable } from './AbstractsTable'

export default async function AbstractsPage({
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
    scope: 'abstracts',
  })
  if (props === undefined) return null

  return <AbstractsTable {...props} />
}
