// /admin/[eventId]/abstracts/[submissionId]
//
// The organizer's view of one submission, and the surface whose absence cost the most in
// the eval run. Nothing in the Abstracts table opened a record: a click select-copied
// text and the status cell opened a popover, so the abstract body, the custom field
// answers, the participant roster with roles and every reviewer comment were unreadable
// anywhere in the product, on the organizer side, at all.
//
// `notFound()` is called from the PAGE BODY and not from the component below it, and that
// is load-bearing rather than tidy. A `notFound()` reached from inside a Suspense boundary
// renders the 404 page after the status line has already been sent, so the response is
// HTTP 200 carrying a 404 body: nothing errors, nothing is disclosed, and only a status
// check finds it. Three routes in this app were fixed by hoisting exactly this call.
//
// It is also where a decision gets made, not only where one gets read. The page shipped
// read-only, so an organizer who opened a record to read the abstract, the answers and the
// reviews had to go back to the list's bulk bar to act on any of it. `SubmissionDecisionActions`
// calls the same actions that bar calls, over a selection of one.
//
// One file rather than a shell plus a body child. `abstracts/loading.tsx` one level up is
// already the boundary that lets the admin chrome paint, and there is no fast half here
// worth showing ahead of the record itself.

import { notFound } from 'next/navigation'
import { requireEventId } from '@/features/events/resolve-ref'
import { SubmissionDetailPanel } from '@/features/review/SubmissionDetailPanel'
import {
  loadSubmissionDetail,
  type SubmissionDetailView,
} from '@/features/review/submission-detail'
import { previewTrackFix } from '@/features/submissions/track-repair'
import { SubmissionDecisionActions } from './SubmissionDecisionActions'

export const metadata = { title: 'Submission' }

export default async function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ eventId: string; submissionId: string }>
}) {
  const { eventId: eventRef, submissionId } = await params
  const eventId = await requireEventId(eventRef)
  const view = await loadSubmissionDetail({ eventId, submissionId })
  if (view === undefined) notFound()

  return (
    <SubmissionDetailPanel
      eventId={eventId}
      view={view}
      // Only an admin decides. The actions each re-check that themselves, so this is what
      // the organizer is shown rather than what stops a reviewer: a reviewer gets the
      // read-only chip and none of this component's JavaScript.
      decisions={
        view.role === 'admin' ? (
          <SubmissionDecisionActions
            eventId={eventId}
            submissionId={view.submission.id}
            status={view.submission.status}
            notified={view.submission.notifiedAt !== undefined}
            trackFix={trackFixFor(view)}
          />
        ) : undefined
      }
    />
  )
}

/**
 * The organizer-visible half of `track-repair.ts`, computed here rather than passed a
 * write: this route already has `view.submission` and `view.form` in hand from the SAME
 * read `SubmissionDetailPanel` uses for the header's "Assigned track" chip, so checking is
 * a pure function call, not a second request. `previewTrackFix` is silent whenever the
 * submission's own answers name no track directly (routing, a default, or a genuine
 * reassignment made some other way), so this can never surface a "fix" for one of those.
 *
 * Scoped to `accepted`: that is the row this exists for (`track-repair.ts`'s header) -
 * one that passed through the accept transition before it started reconciling tracks on
 * its own, and that will not pass through it again. A pending or staged row still gets the
 * automatic reconciliation the moment it IS accepted, so surfacing this control earlier
 * would just be noise ahead of a fix that is coming anyway.
 */
function trackFixFor(
  view: SubmissionDetailView,
): { trackId: string; trackName?: string } | undefined {
  if (view.submission.status !== 'accepted' || view.form === undefined) return undefined
  const trackId = previewTrackFix(view.submission, view.form)
  if (trackId === undefined) return undefined
  return { trackId, trackName: view.nameOf(trackId) }
}
