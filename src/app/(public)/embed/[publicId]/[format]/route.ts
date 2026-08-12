// The embed's non-HTML representations: `.html`, `.json`, `.xml` and `.ics`.
//
// ADDRESSING. What a reader types is an extension on the embed's own URL:
//
//   /embed/<publicId>.json    ->  this handler, with format = "json"
//
// The two spellings are joined by an `afterFiles` rewrite in next.config.ts, because a Next
// dynamic segment has to be a WHOLE path segment: there is no `[publicId].json` directory to
// write, and the alternatives (a proxy, or content negotiation on `Accept`) either add a
// per-request hop or fail the one client that matters, since a calendar app subscribes to a URL
// and sends no `Accept` header worth honouring. The rewrite is the only place the two meet, so
// `/embed/<publicId>/json` also answers; that is the internal address and nothing links to it.
//
// A ROUTE HANDLER and not a page, for the obvious reason: a page cannot set a `Content-Type`, and
// these four exist to be `application/json`, `application/xml`, `text/calendar` and `text/html`.
//
// UNAUTHENTICATED, exactly like the page next to it, and the enabled check is the same one:
// `readEmbedFeedSource` composes `readServedEmbed`, so a disabled embed and an unknown id both
// answer 404 in every format, and the organizer's Filters and Field Options apply to the feed
// before it is serialized. THE QUERY STRING CANNOT WIDEN ANY OF THAT. The only two parameters
// that survive validation pick a LAYOUT and narrow to one speaker (@/features/cms/deep-link),
// and both are applied after the visibility rule and the filters have already chosen the rows.

import { embedRawParams } from '@/features/cms/deep-link'
import { embedFeedHtml } from '@/features/cms/feed-html'
import { embedCalendarFilename, embedFeedIcs } from '@/features/cms/feed-ics'
import { type EmbedFeed, embedFeed, embedFeedJson } from '@/features/cms/feed-model'
import { readEmbedFeedSource } from '@/features/cms/feed-read'
import { embedFeedXml } from '@/features/cms/feed-xml'
import {
  type EmbedFeedKind,
  embedFeedContentType,
  embedFeedKind,
} from '@/features/cms/format-options'

/**
 * A minute at the HTTP layer, and no more.
 *
 * The Airtable reads underneath are tagged and expire the moment a write names their tag
 * (`invalidate`), so this window is the only staleness a change has to wait out. It is short
 * because an embed is on somebody else's website and a stale programme is the failure mode that
 * gets noticed; it is non-zero because a calendar client polling a subscription should not reach
 * the origin's read path every time.
 */
const CACHE_CONTROL = 'public, max-age=60, s-maxage=60, stale-while-revalidate=300'

export async function GET(
  request: Request,
  context: { params: Promise<{ publicId: string; format: string }> },
): Promise<Response> {
  const { publicId, format } = await context.params
  const kind = embedFeedKind(format)
  // An unrecognised extension is 404 and is never echoed back: this response is rendered by
  // whatever the reader pointed at it, so nothing from the URL reaches the body.
  if (kind === undefined) return notFound()

  const search = new URL(request.url).searchParams
  const source = await readEmbedFeedSource(
    publicId,
    embedRawParams(search),
    // The calendar asks for the day-grouped session view whatever the embed's own view is: an
    // .ics of a speaker roster is an empty calendar. Every other format serializes the embed as
    // the organizer configured it.
    kind === 'ics' ? { view: 'agenda' } : {},
  )
  if (source === undefined) return notFound()

  const now = new Date().toISOString()
  const feed = embedFeed(source.projection, now)
  const body =
    kind === 'ics'
      ? embedFeedIcs({ feed, timeZone: source.timeZone, dtstamp: now })
      : serialize(kind, feed)

  return new Response(body, { headers: headersFor(kind, feed) })
}

function serialize(kind: Exclude<EmbedFeedKind, 'ics'>, feed: EmbedFeed): string {
  switch (kind) {
    case 'html':
      return embedFeedHtml(feed)
    case 'json':
      return embedFeedJson(feed)
    case 'xml':
      return embedFeedXml(feed)
  }
}

function headersFor(kind: EmbedFeedKind, feed: EmbedFeed): Headers {
  const headers = new Headers({
    'content-type': embedFeedContentType(kind),
    'cache-control': CACHE_CONTROL,
    // The same rule the styled page states in its `metadata`: the canonical page for this
    // content is the organizer's own website, and a bare feed competing with it in search
    // results is a worse answer to the same query.
    'x-robots-tag': 'noindex, nofollow',
  })
  if (kind === 'ics') {
    // An attachment, so a browser hands the file to the calendar app rather than printing it.
    // A subscribing client fetches the URL directly and ignores this header entirely.
    headers.set(
      'content-disposition',
      `attachment; filename="${embedCalendarFilename(feed.event)}"`,
    )
  }
  return headers
}

/** Unknown id, disabled embed and unknown extension, answered identically. */
function notFound(): Response {
  return new Response('Not found\n', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex, nofollow' },
  })
}
