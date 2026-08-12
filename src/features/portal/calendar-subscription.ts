// The "Subscribe to my schedule" URL, and why it is a subscription rather than an invite.
//
// Requirement 3 asks for calendar invites delivered to each speaker's own calendar, and bodo
// already sends those: `buildInvite` in `src/features/comms/ics.ts` mails a real VEVENT with
// a stable UID and a SEQUENCE bump. What an invite cannot do is survive the agenda moving
// twice on the morning of the event. A subscription URL is re-fetched by the calendar client
// on its own schedule, so the speaker's phone is right without anybody re-sending anything.
//
// **None of the feed is new.** `/embed/<publicId>.ics` already serves `text/calendar`, already
// filters to the published schedule, and `src/features/cms/deep-link.ts` already understands a
// per-speaker parameter. Nothing linked to it, which is the entire gap this closes.

import { EMBED_SPEAKER_PARAM } from '@/features/cms/deep-link'

/**
 * `webcal://` rather than `https://`, and it is the whole point of the control.
 *
 * An `https` link to an `.ics` file DOWNLOADS a file, which imports a frozen copy of today's
 * schedule: the speaker ends up with exactly the stale calendar this feature exists to avoid,
 * and believes they are subscribed. `webcal` is the de-facto scheme every calendar client
 * registers a handler for, and it opens the subscribe dialog instead.
 *
 * The scheme is swapped rather than prefixed, so an origin that is already `http` on a
 * developer's machine does not produce `webcal://http://localhost`.
 */
export function calendarSubscriptionUrl(input: {
  appUrl: string
  publicId: string
  speakerId: string
}): string {
  const url = new URL(`/embed/${input.publicId}.ics`, input.appUrl)
  url.searchParams.set(EMBED_SPEAKER_PARAM, input.speakerId)
  return `webcal://${url.host}${url.pathname}${url.search}`
}

/**
 * The https form of the same feed, for the "or copy this link" affordance beside it.
 *
 * Some clients (and every command-line tool) want the plain URL, and a speaker whose browser
 * has no `webcal` handler registered gets nothing at all from the button alone. Offering both
 * costs one line and removes the one failure mode this control has.
 */
export function calendarFeedUrl(input: {
  appUrl: string
  publicId: string
  speakerId: string
}): string {
  const url = new URL(`/embed/${input.publicId}.ics`, input.appUrl)
  url.searchParams.set(EMBED_SPEAKER_PARAM, input.speakerId)
  return url.toString()
}
