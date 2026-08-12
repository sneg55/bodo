// The embed's URL, and the snippet ref 33's "Get Code" tab hands over.
//
// WHAT "Get Code" OUTPUTS IS AUTHORED, NOT TRANSCRIBED. Both screenshots have the Preview tab
// selected, so docs/parity/cms-embeds.md records the contents of that tab as an ambiguity
// ("script tag, iframe, or raw URL, and whether it differs per view"). This is deliberately
// the smallest thing that works: one `<iframe>` element pointing at the served route, and the
// raw URL beside it. No script tag, because a script would be ours running inside a stranger's
// page, which is a bigger promise than an optional P2 surface should make, and no per-view
// variation, because the view is a property of the embed rather than of the snippet.
//
// The escaping is the part with a rule in it. The embed's name goes into the iframe's `title`,
// which is a required accessible name, and an organizer can call an embed `Ada's "big" feed`.
// Pasted unescaped into somebody else's HTML that is an attribute break, so `escapeAttribute`
// runs over it and is tested. The URL needs no escaping because `publicId` is minted by
// `nanoid` and every deep-link value is validated by ./deep-link before it reaches here.

import { type EmbedDeepLink, embedQueryString } from '@/features/cms/deep-link'
import { embedFormatIsFramed, embedFormatSuffix } from '@/features/cms/format-options'
import type { EmbedFormat } from '@/types/cms'

/** The styled route. Spelled once so the route and every link agree. */
export function embedPath(publicId: string, link: EmbedDeepLink = {}): string {
  return `/embed/${publicId}${embedQueryString(link)}`
}

/** The absolute URL a third-party page loads. `origin` comes from `appUrl()`. */
export function embedUrl(origin: string, publicId: string, link: EmbedDeepLink = {}): string {
  return `${origin.replace(/\/+$/u, '')}${embedPath(publicId, link)}`
}

/**
 * The path one FORMAT is served at: the styled route, or that route plus an extension.
 *
 * The suffix and its meaning live in ./format-options, so the rewrite in next.config.ts, the
 * route handler and this link are all spelling the same four extensions from one place.
 */
export function embedFormatPath(
  publicId: string,
  format: EmbedFormat,
  link: EmbedDeepLink = {},
): string {
  return `/embed/${publicId}${embedFormatSuffix(format)}${embedQueryString(link)}`
}

export function embedFormatUrl(
  origin: string,
  publicId: string,
  format: EmbedFormat,
  link: EmbedDeepLink = {},
): string {
  return `${origin.replace(/\/+$/u, '')}${embedFormatPath(publicId, format, link)}`
}

/** What "Get Code" hands over for one embed: a URL, and the thing to paste, if there is one. */
export type EmbedShare = {
  /** The embed's canonical URL in its own format. Always copyable. */
  url: string
  /** The markup to paste, for the two formats a page can actually embed. */
  snippet?: string
  /** The heading over the code box. Absent when there is no code box. */
  snippetLabel?: string
  /** One line saying what to do with the URL, per format. */
  hint: string
}

const FRAMED_HINT = 'Paste this where the schedule should appear. The URL below opens it alone.'
const FEED_HINT = 'Point your site, importer or calendar client at this URL.'

/**
 * The Get Code tab's contents, decided by the embed's Format.
 *
 * An iframe is offered for the two HTML formats and NOT for the three feeds, which is the whole
 * distinction: framing a JSON document shows a reader a page of braces, and a snippet that
 * pretended otherwise would be a control that appears to work. A feed's deliverable is its URL.
 */
export function embedShare(input: {
  origin: string
  publicId: string
  format: EmbedFormat
  name: string
  link?: EmbedDeepLink
  height?: number
}): EmbedShare {
  const url = embedFormatUrl(input.origin, input.publicId, input.format, input.link ?? {})
  if (!embedFormatIsFramed(input.format)) return { url, hint: FEED_HINT }
  return {
    url,
    snippet: embedSnippet({
      url,
      name: input.name,
      ...(input.height === undefined ? {} : { height: input.height }),
    }),
    snippetLabel: 'Embed code',
    hint: FRAMED_HINT,
  }
}

/** The default frame height. Authored: an agenda is tall, and the host page can change it. */
const DEFAULT_HEIGHT = 640

export function embedSnippet(input: { url: string; name: string; height?: number }): string {
  const height = input.height ?? DEFAULT_HEIGHT
  return [
    `<iframe src="${input.url}"`,
    `  title="${escapeAttribute(input.name)}"`,
    `  width="100%" height="${height}" loading="lazy"`,
    '  style="border:0;max-width:100%"></iframe>',
  ].join('\n')
}

/**
 * The five characters that can break out of a double-quoted HTML attribute.
 *
 * `&` first, or the escapes escape each other's ampersands and `&amp;` becomes `&amp;amp;`.
 */
export function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
