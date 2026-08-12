// The one read behind every PUBLIC surface: the agenda page and the CMS embeds.
//
// Split out of ./queries.ts when that file passed the size budget, and it is the right
// seam rather than an arbitrary one: everything else in there answers an authenticated
// screen, while this answers an anonymous visitor, so this is the read whose filter is a
// disclosure boundary rather than a convenience.
//
// Re-exported from ./queries.ts, which stays the one import boundary. Nothing outside this
// directory changed when it moved.

import { publicSessionRows } from '@/features/agenda/public-agenda'
import { getSource } from '@/services/airtable/source'
import type { SubmissionWithParticipants } from '@/types/domain'

/**
 * The public agenda: PUBLISHED, accepted, uncancelled rows whose content is APPROVED.
 *
 * The first rule is what makes the `published` state mean something. Without a reader that
 * filters on it, an organizer rearranging a half-built schedule is doing so in public,
 * which is the exact thing the third schedule state exists to prevent.
 *
 * The last is the content gate, and it is the reason this calls `publicSessionRows` rather
 * than `publicAgendaRows`: a published, accepted, uncancelled session whose `contentStatus`
 * is not `approved` is still not public. Applied HERE rather than in the agenda page, so it
 * covers the embeds too, and so no future public surface can be built that forgets it.
 *
 * It is not silent. What is being withheld, and why, is reported back on the admin agenda:
 * `publicWithholding` in @/features/agenda/public-agenda feeds both the toolbar's
 * publication badge and the Schedule Status cell of every row.
 *
 * The filter is applied here and the caching happens underneath, on the `Submissions`
 * request itself, which is why `listSubmissions` subscribes to the published-agenda tag as
 * well as its own (see `submissionsCache` in reads.ts): the admin table and the embeds are
 * served from the same cache entry, so publishing has to expire it. Marking content
 * approved expires it for the same reason, through `invalidate()` at the write.
 *
 * Ordered by start time: a public schedule with no order is not a schedule.
 */
export async function listPublishedAgenda(
  eventId: string,
): Promise<readonly SubmissionWithParticipants[]> {
  return publicSessionRows(await getSource().listSubmissions(eventId))
}
