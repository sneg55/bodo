// /admin/[eventId]/evaluation
//
// One file, not a static shell plus an `EvaluationBody` child inside `<Suspense>`. That
// split existed only because `cacheComponents` refused a page body that awaited `params`
// or `searchParams`. `loading.tsx` renders the same `EvaluationSkeleton` this page used as
// a fallback.

import { isAppError } from '@/constants/errorIds'
import type { EventRole } from '@/constants/status'
import { requireEventRole } from '@/features/auth/wiring'
import { requireEventId } from '@/features/events/resolve-ref'
import type { RawSearchParams } from '@/features/review/abstracts-query'
import { loadEvaluationView } from '@/features/review/evaluation-view'

import { EvaluationPanel } from './EvaluationPanel'

type Identity = { userId: string; role: EventRole }

export default async function EvaluationPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>
  searchParams: Promise<RawSearchParams>
}) {
  const [{ eventId: eventRef }, raw] = await Promise.all([params, searchParams])
  const eventId = await requireEventId(eventRef)

  const identity = await currentIdentity(eventId)
  // The layout redirects an unauthorized browser. This is not the security boundary:
  // `saveReviewAction` re-checks the role AND the assignment for itself, because a Server
  // Action is reachable without this page ever rendering. BUILD_SPEC 4.
  if (identity === undefined) return null

  const view = await loadEvaluationView({
    eventId,
    reviewerId: identity.userId,
    role: identity.role,
    roundId: single(raw.round),
  })

  return (
    <EvaluationPanel eventId={eventId} view={view} selectedSubmissionId={single(raw.submission)} />
  )
}

function single(value: string | readonly string[] | undefined): string | undefined {
  if (value === undefined) return undefined
  return typeof value === 'string' ? value : value.at(0)
}

/**
 * `reviewer` is the floor for reading this surface, and `roleSatisfies` ranks `admin`
 * above it, so an organizer sees their own queue plus the assignment panel.
 */
async function currentIdentity(eventId: string): Promise<Identity | undefined> {
  try {
    return await requireEventRole(eventId, 'reviewer')
  } catch (error) {
    if (isAppError(error) && error.id.startsWith('E_AUTH')) return undefined
    throw error
  }
}
