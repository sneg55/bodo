// One rule, in one place: a submission that changes status tells the webhook subscribers.
//
// It is a module rather than a helper inside `decisions.ts` because the paths that move a
// submission are not all in `decisions.ts`. There are five of them across three files, and
// exactly ONE of them announced anything: the bulk queue action. So an organizer editing a
// status chip inline, an organizer pressing Notify, a speaker sending a draft for review and
// a speaker withdrawing all wrote a real state change that no subscriber ever heard about.
//
// That failure is invisible from both ends, which is why it survived. The write lands, the
// screen updates, and the delivery queue is simply empty, so there is no error to notice and
// nothing to grep for. Adding four more `announceStatusChange` calls would fix today's five
// paths and leave the sixth free to forget, so the pair is fused here instead: to move a
// submission you call this, and the announcement is not a separate thing you can omit.
//
// It also reconciles the track the moment a submission BECOMES `accepted`, for the same
// reason: accepting is the one write that turns a submission into a session, and it is the
// first point the agenda and the public site start reading `trackId`. `track-repair.ts`
// carries the actual rule (`staleTrackId`, `track-precedence.ts`); this only decides WHEN to
// run it. Every one of the five paths above funnels through here, so wiring it here rather
// than at each caller is the same argument the announcement already made once.
//
// Beyond that it deliberately does NOT invalidate anything `setSubmissionStatus` was not
// already invalidating. The portal writes expire the acting speaker's own tag as well, which
// is theirs to know about, and hiding that in here would make one caller's concern
// everybody's. The track reconciliation is the one exception, and it brings its own
// invalidation: `applyTrackFix` writes through `updateSubmission`, which expires the
// submission's own tags and the agenda tag, so nothing extra is needed here for it either.

import { isAppError } from '@/constants/errorIds'
import type { SubmissionStatus } from '@/constants/status'
import { applyTrackFix, type TrackRepairSubject } from '@/features/submissions/track-repair'
import { announceStatusChange } from '@/features/webhooks/announce'
import { setSubmissionStatus } from '@/services/airtable/mutations'
import { listForms } from '@/services/airtable/queries'
import type { RecordId, SubmissionWithParticipants } from '@/types/domain'

/** Everything the write, the announcement and the track reconciliation need. Any loaded
 *  submission row satisfies it. */
export type MovableSubmission = Pick<SubmissionWithParticipants, 'id' | 'code' | 'title'> &
  TrackRepairSubject & {
    /** The status being LEFT, so a subscriber can render "Pending → Accepted". */
    readonly status: SubmissionStatus
  }

/**
 * Move a submission to `status` and tell every subscriber that it moved.
 *
 * The announcement runs after the write and cannot fail it: `announceStatusChange` swallows
 * its own errors, per the header of `announce.ts`. A mis-typed URL in some settings row must
 * not turn an accept into a failed action with the row already written.
 *
 * `notifiedAt` is the decision path's stamp and is simply passed through; the write ignores
 * an absent one rather than clearing the column.
 */
export async function commitStatus(
  eventId: RecordId,
  row: MovableSubmission,
  status: SubmissionStatus,
  notifiedAt?: string,
): Promise<void> {
  await setSubmissionStatus({ submissionId: row.id, eventId, status, notifiedAt })
  if (status === 'accepted') await reconcileTrackOnAccept(eventId, row)
  await announceStatusChange(eventId, row, status, row.status)
}

/**
 * Best-effort, and deliberately so, on the same reasoning `announceStatusChange` states
 * above it: this is a data-quality correction, not the accept itself, and a submission
 * whose track could not be checked must still finish becoming accepted. A form the
 * builder deleted since the record was submitted, or a transient read failure, is logged
 * and swallowed rather than thrown.
 *
 * `applyTrackFix` (and `staleTrackId` underneath it) already refuses to touch a record
 * with no direct, still-resolvable Track answer, so this never overwrites a track that
 * came from routing or from an organizer's own reassignment - see that function's header
 * for the full argument. It only ever replaces a stored value with the answer the speaker
 * gave, when the two disagree.
 */
async function reconcileTrackOnAccept(eventId: RecordId, row: MovableSubmission): Promise<void> {
  if (row.formId === undefined) return
  try {
    const forms = await listForms(eventId)
    const form = forms.find((candidate) => candidate.id === row.formId)
    if (form === undefined) return
    await applyTrackFix(eventId, row, form)
  } catch (error) {
    console.error(
      `[commit-status] track reconciliation failed for ${row.code}: ${
        isAppError(error) ? error.toLogLine() : String(error)
      }`,
    )
  }
}
