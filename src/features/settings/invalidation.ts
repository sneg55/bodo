// Which cache tags an Event Details save expires.
//
// This is the one part of Event Settings that is not obvious, and getting it wrong shows
// up as a public page rather than as an admin one.
//
// `getEventBySlug` (reads.ts) caches the whole event record under `eventSlugTag(slug)`,
// keyed on the SLUG and not on the record id, because the slug is what the public URL
// carries and a request's tags have to be set before it goes out. So:
//
//   - Every save expires `eventTag(eventId)`, which is what the admin shell, the event
//     switcher and `getEvent` read, and `eventSlugTag(previousSlug)`, because the name,
//     the timezone and the dates all reach `/agenda/{slug}` through that entry.
//   - A slug CHANGE has to expire BOTH slug tags. The old one because it now resolves to
//     an event that no longer answers that URL, and the new one because a request under
//     the new slug may already have been cached as a miss: `eventSlugTag` exists
//     separately from `eventTag` precisely so that "this slug resolves to nothing" is
//     itself an expirable entry. Expiring only one leaves the public agenda serving a
//     stale page under the old slug or a 404 under the new one.
//
// Nothing else is named. Room and time assignments live on `Submissions` rows and are not
// touched by this write, so `event:{id}:agenda` stays valid: invalidating widely costs
// every screen in the product (BUILD_SPEC 6.1).

import type { Invalidation } from '@/services/airtable/invalidate'
import { eventSlugTag, eventTag } from '@/services/airtable/tags'

export type SettingsWriteScope = {
  eventId: string
  /** The slug the record held before this write. */
  previousSlug: string
  /** The slug being written. Equal to `previousSlug` when the slug is unchanged. */
  nextSlug: string
}

export function eventSettingsInvalidation(scope: SettingsWriteScope): Invalidation {
  const previousRaw = scope.previousSlug.trim()
  const previous = previousRaw.toLowerCase()
  const next = scope.nextSlug.trim().toLowerCase()

  // The RAW previous slug as well as its lowercased form, and they are not always the same
  // thing. `getEventBySlug` tags on the slug exactly as it came off the URL, so an event
  // stored with a legacy `Ai-Engineer` slug has a cached agenda under `event:slug:Ai-Engineer`.
  // Expiring only the normalized `ai-engineer` left that entry alive, and the public agenda
  // kept serving a URL that no longer resolved. Found by Codex review.
  const previousTags =
    previousRaw === previous
      ? [eventSlugTag(previous)]
      : [eventSlugTag(previous), eventSlugTag(previousRaw)]

  return {
    own: [eventTag(scope.eventId), ...previousTags],
    // Other people's screens: the public agenda under the slug nobody has requested yet.
    others: next === previous ? [] : [eventSlugTag(next)],
  }
}

/** Every tag this write expires, in one list, for a caller that does not care which side. */
export function eventSettingsTags(scope: SettingsWriteScope): readonly string[] {
  const invalidation = eventSettingsInvalidation(scope)
  return [...invalidation.own, ...(invalidation.others ?? [])]
}
