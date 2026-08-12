'use server'

// The CRM's one destructive write: merging duplicate speaker records.
//
// A separate module from `actions.ts` because that file is at its size budget, and because
// this one has a stricter authorization rule than everything in it. The rest of the CRM
// authorizes on `scope.eventIds`, which is every event the viewer holds ANY membership on,
// including the reviewer ones: reading a directory and tagging a person are things a reviewer
// may do. Deleting somebody's record is not. So this checks against `scope.adminEventIds`,
// the subset the viewer holds `admin` on, which `CrmScope`'s own doc names as "what a CRM
// WRITE has to be scoped to".
//
// The check is the roster read itself rather than a comparison afterwards.
// `listSpeakersInEvents(scope.adminEventIds)` already intersects each speaker's event links
// with that set and drops anyone left with none, so a record reachable only through a reviewer
// membership - or through somebody else's event entirely - simply is not in the answer, and
// `checkMerge` refuses it. It is the same cached read the directory just performed under a
// different argument, so the guard costs at most one request.
//
// Authorization is recomputed here and never taken from the layout, for the reason
// `(admin)/admin/crm/layout.tsx` states in its own header: a Server Action is reachable by
// POST whether or not any page rendered.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { checkMerge, type MergeRequest } from '@/features/crm/merge'
import { requireCrmScope } from '@/features/crm/scope'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { mergeSpeakers, type SpeakerMergeResult } from '@/services/airtable/mutations-crm-merge'
import { listSpeakersInEvents } from '@/services/airtable/queries'

/**
 * Merge the selected records into the chosen primary.
 *
 * Returns the write's own counts rather than `void`, so the toast can say what happened
 * ("3 records merged, 2 duplicate session entries removed") instead of "Saved successfully".
 * A destructive action reporting only success is how an organizer finds out a week later that
 * it did more than they expected.
 */
export async function mergeSpeakersAction(
  input: MergeRequest,
): Promise<ActionResult<SpeakerMergeResult>> {
  try {
    const scope = await requireCrmScope()
    const roster = await listSpeakersInEvents(scope.adminEventIds)
    const reachable = new Set(roster.map((entry) => entry.speaker.id))

    const checked = checkMerge(input, reachable)
    if (!checked.ok) {
      throw new AppError(ErrorIds.DATA_WRITE_FAIL, checked.reason)
    }

    return actionOk(await mergeSpeakers('action', checked.plan))
  } catch (error) {
    return actionFailure(error)
  }
}
