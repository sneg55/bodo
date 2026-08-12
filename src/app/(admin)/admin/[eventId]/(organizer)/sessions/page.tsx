// /admin/[eventId]/sessions
//
// The SUBMISSIONS section's third entry (ref 19). The same table as Abstracts, filtered to
// the rows that were never meant for review: `reviewRequired: false`, stamped at creation
// from the form's `entityKind` and never re-read. `features/review/submission-scope.ts`
// carries that rule and `features/dashboard/status-mix.ts` explains why it is not a lookup
// through the form.

import { requireEventId } from '@/features/events/resolve-ref'
import type { RawSearchParams } from '@/features/review/abstracts-query'
import { loadSubmissionsSurface } from '@/features/review/submissions-page'

import { AbstractsTable } from '../abstracts/AbstractsTable'

export default async function SessionsPage({
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
    scope: 'sessions',
  })
  if (props === undefined) return null

  return <AbstractsTable {...props} />
}
