// Shapes the cross-event CRM reads return.
//
// Separate from `domain.ts` because these are not domain entities. A `Speaker` is a person
// and exists whoever is looking; the shape below is a PROJECTION, and the same speaker
// yields a different one for two organizers because each sees only the events they hold a
// membership on. `domain.ts` is also at its 300-line budget, and growing it with read
// shapes is how a types file becomes the place everything lands.

import type { RecordId, Speaker } from '@/types/domain'

/**
 * A speaker plus which of the events the caller ASKED ABOUT they are on.
 *
 * `eventIds` is always the intersection with the caller's scope, never the speaker's whole
 * history: the directory's Events column answers "how many of your events is this person
 * on", and the events they did elsewhere are not the viewer's to count.
 *
 * It exists so that count can come out of the roster read the CRM already performs. The
 * links are in those records (`speakerEventIds`); `Speaker` simply has nowhere to put them.
 */
export type SpeakerInEvents = {
  speaker: Speaker
  eventIds: readonly RecordId[]
}
