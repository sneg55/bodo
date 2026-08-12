// The read behind the four feed formats, and the one behind the styled page's redirect.
//
// It composes `readServedEmbed` (./reads) rather than reimplementing it, and that is the whole
// security argument for this module: the HTML page and the `.json`, `.xml`, `.ics` and `.html`
// URLs must answer with the same rows, or the feed becomes a way around the organizer's Filters
// section. One projection, five representations.
//
// TWO THINGS ARE ADDED ON TOP OF THAT READ, and each is small on purpose:
//
//   1. The event's TIMEZONE. The projection deliberately carries only the event's name across
//      (see `readServedEmbed`), and the calendar feed wants the zone as an `X-WR-TIMEZONE`
//      display hint. It is read here, from the same cached `getEvent` the projection's own read
//      already awaited, so it costs no extra round trip.
//   2. A VIEW OVERRIDE, for the calendar. An `.ics` of a Speaker Gallery embed would be an empty
//      calendar, which is valid and useless, so the route asks for the day-grouped session view
//      instead. It is an override of the LAYOUT only and it can widen nothing: the view picks a
//      shape over rows the visibility rule and the filters have already chosen (./deep-link).
//
// The `enabled` check is `readServedEmbed`'s, and it is repeated here for the cheap reason its
// own comment gives: a disabled embed must not cost an event read and a projection just to be
// refused. `undefined` from either half means the URL does not resolve, in every format.

import { EMBED_VIEW_PARAM, type RawParams } from '@/features/cms/deep-link'
import type { EmbedProjection } from '@/features/cms/projection'
import { readServedEmbed } from '@/features/cms/reads'
import { getCmsEmbedByPublicId, getEvent } from '@/services/airtable/queries'
import type { EmbedFormat, EmbedView } from '@/types/cms'

export type EmbedFeedSource = {
  projection: EmbedProjection
  /** The event's IANA timezone, for the calendar's display hint. */
  timeZone: string
}

/**
 * The projection a feed serializes, or `undefined` for "this URL does not resolve".
 *
 * Unknown id and disabled embed are indistinguishable from outside, exactly as they are on the
 * HTML page: a distinguishable response would let anybody walk the id space and learn which
 * embeds exist and which an organizer has switched off.
 */
export async function readEmbedFeedSource(
  publicId: string,
  params: RawParams,
  options: { view?: EmbedView } = {},
): Promise<EmbedFeedSource | undefined> {
  const embed = await getCmsEmbedByPublicId(publicId)
  if (embed === undefined || !embed.enabled) return undefined

  const [event, projection] = await Promise.all([
    getEvent(embed.eventId),
    readServedEmbed(publicId, withView(params, options.view)),
  ])
  if (projection === undefined) return undefined
  return { projection, timeZone: event.timezone }
}

/**
 * The embed's stored `Format`, so the styled route can send a feed-format embed to its own URL.
 *
 * `undefined` for an unknown or disabled embed, which is what keeps the redirect from being a
 * disclosure: a switched-off embed falls through to the same 404 as an id that names nothing,
 * rather than answering 307 and confirming it exists.
 */
export async function readEmbedFormat(publicId: string): Promise<EmbedFormat | undefined> {
  const embed = await getCmsEmbedByPublicId(publicId)
  return embed === undefined || !embed.enabled ? undefined : embed.format
}

/**
 * The visitor's own query, with the view forced when the caller asked for one.
 *
 * Written into the same `sb-view` parameter the deep-link parser reads, rather than passed
 * around it, so there is one code path deciding what a view value is allowed to be.
 */
function withView(params: RawParams, view: EmbedView | undefined): RawParams {
  if (view === undefined) return params
  // Built from entries rather than spread, for the reason `parseEmbedDeepLink` copies into a
  // Map: this object came off a URL, and a parameter literally named `__proto__` would
  // otherwise reach an object literal's prototype.
  return Object.fromEntries([...Object.entries(params), [EMBED_VIEW_PARAM, view]])
}
