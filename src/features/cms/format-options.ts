// What an embed's `Format` means at the URL, and what each format is called.
//
// The Format field used to be Locked with one value, `Styled HTML`, and the served embed had
// exactly one representation: an HTML page meant for an iframe. That is now the DEFAULT rather
// than the only option, and the other four are real feeds a website or a calendar client reads.
//
// ONE ADDRESSING SCHEME, and it is a file extension on the public id:
//
//   /embed/<publicId>        styled HTML, the iframe page (unchanged)
//   /embed/<publicId>.html   basic HTML, one document, no CSS and no JavaScript
//   /embed/<publicId>.json   the same feed as JSON
//   /embed/<publicId>.xml    the same feed as XML
//   /embed/<publicId>.ics    the sessions as a calendar
//
// A suffix rather than `?format=` or content negotiation, for three reasons. It is what a reader
// guesses first, so the feed is discoverable from the HTML URL alone. It survives being pasted
// into a calendar client, which subscribes to a URL and sends no `Accept` header worth honouring.
// And it keeps the query string free for the deep-link parameters (./deep-link), which apply to
// every format identically.
//
// The extension is mapped by `next.config.ts` onto `/embed/<publicId>/<kind>`, which is where the
// route handler lives, because a Next dynamic segment must be a WHOLE path segment: there is no
// `[publicId].json` directory to write. That rewrite is the only place the two spellings meet.

import type { EmbedFormat } from '@/types/cms'

/** The path segment the rewrite lands on, and the only vocabulary the route handler accepts. */
export const EMBED_FEED_KINDS = ['html', 'json', 'xml', 'ics'] as const
export type EmbedFeedKind = (typeof EMBED_FEED_KINDS)[number]

/**
 * A URL segment, validated.
 *
 * Anything else is `undefined` and the route answers 404, so an unknown extension cannot reach a
 * serializer and cannot be reflected back into a response.
 */
export function embedFeedKind(raw: string): EmbedFeedKind | undefined {
  return EMBED_FEED_KINDS.find((kind) => kind === raw)
}

// Maps rather than objects indexed by a variable key, for the reason src/types/cms.ts gives:
// `security/detect-object-injection` refuses a computed index on a record, and the lint-on-edit
// hook runs at zero warnings.

/** The extension each format's canonical URL carries. Styled HTML carries none. */
const FORMAT_SUFFIXES = new Map<EmbedFormat, string>([
  ['styled_html', ''],
  ['basic_html', '.html'],
  ['json', '.json'],
  ['xml', '.xml'],
  ['ical', '.ics'],
])

export function embedFormatSuffix(format: EmbedFormat): string {
  return FORMAT_SUFFIXES.get(format) ?? ''
}

/** The feed a format is served by, or `undefined` for the styled page, which is not a feed. */
const FORMAT_KINDS = new Map<EmbedFormat, EmbedFeedKind>([
  ['basic_html', 'html'],
  ['json', 'json'],
  ['xml', 'xml'],
  ['ical', 'ics'],
])

export function embedFormatKind(format: EmbedFormat): EmbedFeedKind | undefined {
  return FORMAT_KINDS.get(format)
}

/**
 * The `Content-Type` each feed answers with, charset included.
 *
 * A calendar client keys off `text/calendar` and a browser keys off the charset, so both halves
 * are spelled here rather than assembled at the response.
 */
const CONTENT_TYPES = new Map<EmbedFeedKind, string>([
  ['html', 'text/html; charset=utf-8'],
  ['json', 'application/json; charset=utf-8'],
  ['xml', 'application/xml; charset=utf-8'],
  ['ics', 'text/calendar; charset=utf-8'],
])

export function embedFeedContentType(kind: EmbedFeedKind): string {
  return CONTENT_TYPES.get(kind) ?? 'text/plain; charset=utf-8'
}

/**
 * Whether the format is something an `<iframe>` can present.
 *
 * Both HTML formats are; a JSON, XML or calendar feed is a URL you point something else at, so
 * the editor offers the URL to copy instead of an iframe snippet (./snippet).
 */
export function embedFormatIsFramed(format: EmbedFormat): boolean {
  return format === 'styled_html' || format === 'basic_html'
}

/** The Format card's body copy, per format. The Styled HTML paragraph is verbatim off ref 33. */
const FORMAT_DESCRIPTIONS = new Map<EmbedFormat, string>([
  [
    'styled_html',
    'Configure settings for styled HTML feeds including Agenda, Session List, Schedule Itinerary, Speaker List, and Speaker Gallery. Each embed can be placed directly in your website and will auto-update with speaker and session details.',
  ],
  [
    'basic_html',
    'One plain HTML document with no styles and no scripts, for a site that supplies its own design or a page that inlines the markup at build time.',
  ],
  [
    'json',
    'The same sessions and speakers as JSON, for a site that renders its own agenda. Your filters and field selection apply to the feed exactly as they apply to the rendered embed.',
  ],
  [
    'xml',
    'The same feed as XML, for a CMS or an import job that consumes XML. Your filters and field selection apply to the feed exactly as they apply to the rendered embed.',
  ],
  [
    'ical',
    'A calendar feed of the scheduled sessions, for Google Calendar, Apple Calendar and Outlook. Sessions with no start or end time are left out rather than given a guessed duration.',
  ],
])

export function embedFormatDescription(format: EmbedFormat): string {
  return FORMAT_DESCRIPTIONS.get(format) ?? ''
}

/** Verbatim off ref 33, and still true: the format is chosen per embed. */
export const EMBED_FORMAT_FOOTER = 'Create a new embed to use a different format.'
