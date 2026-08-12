// Who the AI reviewer is, for the two surfaces that have to keep its scores out of a
// human average.
//
// Abstracts and Evaluation both want the `ai@system` id for one purpose: to hand it to
// `ratings.ts`, which excludes NOTHING when it is not told who the AI is (BUILD_SPEC 5.4).
// So the way this read fails is not a missing panel, it is a committee score that quietly
// contains a machine's opinion. That is why the tolerance below is as narrow as it is, and
// why both surfaces go through here rather than each writing their own `.catch`.

import { ErrorIds, isAppError } from '@/constants/errorIds'
import { getAiReviewerId } from '@/services/airtable/reads-prescreen'
import type { RecordId } from '@/types/domain'

/**
 * Whether a failure from `getAiReviewerId()` means "this base was never seeded".
 *
 * The read throws for two kinds of reason and only one of them is ordinary. A base with no
 * `ai@system` AdminUsers row has never run a pre-screen, so it holds no AI reviews either:
 * answering "nobody is the AI" there is not an approximation, it is the truth, and the
 * surface is fully correct with a disabled pre-screen button. `reads-prescreen.ts` raises
 * DATA_RECORD_NOT_FOUND for exactly that case, and tells the operator to run `npm run seed`.
 *
 * Every other failure is operational: the DAL rate limits, backs off and eventually gives
 * up, the base is unreachable, a record fails its schema on the way back. There the row may
 * well exist and its reviews may well be sitting in the list about to be averaged, so
 * answering "nobody" would fold the machine's scores into the organizer's Ratings column
 * with nothing on screen saying so. A wrong average is silent and a failed page is not, so
 * those rethrow and the surface fails where somebody can see it.
 *
 * A non-`AppError` (a bare `Error`, a rejected string) is by definition not the seed case,
 * so it rethrows too.
 */
export function isAiReviewerUnseeded(error: unknown): boolean {
  return isAppError(error) && error.id === ErrorIds.DATA_RECORD_NOT_FOUND
}

/**
 * The AI reviewer's id, or nothing when the base has not been seeded for the pre-screen.
 *
 * The cron and enqueue paths call `getAiReviewerId()` directly and want it to throw, because
 * a pre-screen with no reviewer identity has nowhere to write its reviews. A surface an
 * organizer is reading tolerates the unseeded case, and only that one.
 *
 * `load` exists so the tolerance can be driven from a test without standing up Airtable;
 * every caller in the app takes the default.
 */
export async function aiReviewerOrNone(
  load: () => Promise<RecordId> = getAiReviewerId,
): Promise<RecordId | undefined> {
  try {
    return await load()
  } catch (error) {
    if (isAiReviewerUnseeded(error)) return undefined
    throw error
  }
}
