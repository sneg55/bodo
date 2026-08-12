// /admin/[eventId]/evaluation/plan
//
// Nested under `evaluation/` rather than moved into the `(organizer)` route group,
// because the group's whole point is that `evaluation/` is the REVIEWER's surface and
// stays outside it. So this page does the admin check itself, in the page body, and
// renders the same refusal card the group's layout renders.
//
// In the BODY and not inside a boundary: a `redirect()` resolved after the shell has
// flushed never produces a response on Workers, and `notFound()` answers HTTP 200 with
// the 404 body. `.claude/rules/bodo-conventions.md` has both, measured rather than
// inferred.

import { isAppError } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { requireEventId } from '@/features/events/resolve-ref'
import { loadPlanView } from '@/features/review/plan-view'
import { ReviewerAccessCard } from '@/features/team/ReviewerAccessCard'
import { getEvent } from '@/services/airtable/queries'

import { PlanEditor } from './PlanEditor'

export default async function EvaluationPlanPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)

  if (!(await isOrganizer(eventId))) return <ReviewerAccessCard eventId={eventId} />

  const [view, event] = await Promise.all([loadPlanView(eventId), getEvent(eventId)])

  return <PlanEditor eventId={eventId} view={view} timeZone={event.timezone} />
}

/**
 * `admin` on this event, answered as a boolean rather than by letting the throw escape.
 *
 * Not the security boundary. Every action under this page calls `requireEventRole` for
 * itself, because a Server Action is reachable by POST with no page ever rendering.
 */
async function isOrganizer(eventId: string): Promise<boolean> {
  try {
    await requireEventRole(eventId, 'admin')
    return true
  } catch (error) {
    if (isAppError(error) && error.id.startsWith('E_AUTH')) return false
    throw error
  }
}
