// One speaker id, resolved against one event, for every admin path that takes one.
//
// A speaker id posted to an admin action or an upload route is CLIENT INPUT. Holding
// `admin` on the event in the URL says the caller may edit that event's people; it says
// nothing about whether the id they sent is one of them. Without this resolution, an admin
// of event A could rewrite a speaker who is only on event B by knowing their record id,
// which is the one hole an authorization check on the event alone cannot see.
//
// Extracted from `saveSpeakerProfileAction`, which had it inline, when the headshot upload
// needed the same guard: two copies of a rule like this drift, and the copy that drifts is
// the one nobody is looking at.
//
// It is answered as NOT FOUND rather than as forbidden, deliberately: a distinct "that
// speaker exists but is not yours" would turn this into an oracle for which record ids name
// real speakers.
//
// The read is the cached `listSpeakers`, the same one the action has always used, and the
// staleness that buys is the safe direction: a person added in the last few seconds is
// refused until the tag expires, which is a retry rather than a hole. It cannot admit
// somebody who was never on the event, because a cached list is a list this event once had.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { listSpeakers } from '@/services/airtable/queries'
import type { RecordId, Speaker } from '@/types/domain'

export async function resolveEventSpeaker(
  eventId: RecordId,
  speakerId: RecordId,
): Promise<Speaker> {
  const speaker = (await listSpeakers(eventId)).find((candidate) => candidate.id === speakerId)
  if (speaker === undefined) {
    throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that speaker is not on this event', {
      eventId,
      speakerId,
    })
  }
  return speaker
}
