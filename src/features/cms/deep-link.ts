// The query parameters a served embed answers to. Ref 33's URL bar. R9.
//
// Ref 33 captures one parameter, `sb-speaker-id=abc123`, next to a "Go" button in a simulated
// URL bar, and docs/parity/cms-embeds.md reads it as "deep-link query parameters the embed
// responds to (for example linking directly to one speaker)". So `sb-speaker-id` is
// transcribed. `sb-view` is AUTHORED, and it exists because ref 33's View selector has to
// change what the preview shows before a save has landed; the served embed honours it for the
// same reason a link to one speaker is useful, and it cannot leak anything, because every view
// renders the same event's public rows in a different shape.
//
// Everything here is a validator, and that is the point of putting it in its own tested
// module. Both values arrive from a URL that anybody can edit, and both are used twice: once to
// select records, and once inside the rendered HTML of a page that sits on somebody else's
// website. So a value is either recognised or DROPPED, never passed through:
//
//   - repeated (`?sb-speaker-id=a&sb-speaker-id=b`) takes the first, because Next hands a
//     repeated key over as an array and `String(array)` would build "a,b" and match nothing.
//   - anything outside `[A-Za-z0-9_-]`, or longer than a record id can be, is rejected whole. A
//     record id is `rec` plus 14 alphanumerics, so nothing legitimate is lost, and it means no
//     quote, angle bracket, or Airtable formula operator can reach either use site.
//   - an unrecognised `sb-view` is dropped rather than defaulted to Agenda, so the embed falls
//     back to the view its record stores instead of silently overriding an organizer's choice.

import { EMBED_VIEWS, type EmbedView } from '@/types/cms'

/** Transcribed off ref 33's URL bar, `sb-` prefix included. */
export const EMBED_SPEAKER_PARAM = 'sb-speaker-id'
/** Authored. See the header. */
export const EMBED_VIEW_PARAM = 'sb-view'

/** `rec` + 14 characters is 17; the cap is generous rather than exact on purpose. */
const MAX_ID_LENGTH = 64
const SAFE_ID = /^[A-Za-z0-9_-]+$/u

export type EmbedDeepLink = {
  /** Present only when the value passed validation. */
  speakerId?: string
  view?: EmbedView
}

/** What `searchParams` resolves to on this Next version, and what a URL gives back. */
export type RawParams = Readonly<Record<string, string | readonly string[] | undefined>>

export function parseEmbedDeepLink(params: RawParams): EmbedDeepLink {
  // Copied into a Map before anything is looked up, for the reason records.ts copies a
  // record's fields: this object is built from a URL, so indexing it with a variable key can
  // read off the prototype chain, and a parameter literally named `__proto__` would do it.
  const values = new Map(Object.entries(params))
  const speakerId = safeId(values.get(EMBED_SPEAKER_PARAM))
  const view = EMBED_VIEWS.find((candidate) => candidate === safeId(values.get(EMBED_VIEW_PARAM)))
  return {
    ...(speakerId === undefined ? {} : { speakerId }),
    ...(view === undefined ? {} : { view }),
  }
}

/**
 * The same parse from a query string, for the preview's URL bar.
 *
 * The bar in ref 33 shows the raw `?sb-speaker-id=abc123` an organizer types, so the preview
 * has to parse exactly what the browser would, and `URLSearchParams` is that. Built against a
 * dummy base because the input is a fragment and not an absolute URL.
 */
export function parseEmbedQuery(query: string): EmbedDeepLink {
  const search = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)
  return parseEmbedDeepLink({
    [EMBED_SPEAKER_PARAM]: search.getAll(EMBED_SPEAKER_PARAM),
    [EMBED_VIEW_PARAM]: search.getAll(EMBED_VIEW_PARAM),
  })
}

/**
 * A `URLSearchParams` in the shape `searchParams` hands a page.
 *
 * The feed routes are Route Handlers, so they hold a URL rather than Next's resolved
 * `searchParams`, and this converts one to the other so both halves of the embed parse deep
 * links through the same function. `getAll` rather than `get`, because the parser's rule for a
 * repeated key is to take the FIRST, and `Object.fromEntries(search)` would take the last.
 */
export function embedRawParams(search: URLSearchParams): RawParams {
  return {
    [EMBED_SPEAKER_PARAM]: search.getAll(EMBED_SPEAKER_PARAM),
    [EMBED_VIEW_PARAM]: search.getAll(EMBED_VIEW_PARAM),
  }
}

/**
 * Back to a query string, so the preview iframe and "open in new tab" go to the same URL.
 *
 * Only validated values are ever serialised, which is what keeps the round trip honest: a
 * hostile value the parser dropped cannot come back out of here and end up in an href.
 */
export function embedQueryString(link: EmbedDeepLink): string {
  const search = new URLSearchParams()
  if (link.view !== undefined) search.set(EMBED_VIEW_PARAM, link.view)
  if (link.speakerId !== undefined) search.set(EMBED_SPEAKER_PARAM, link.speakerId)
  const query = search.toString()
  return query === '' ? '' : `?${query}`
}

function safeId(raw: string | readonly string[] | undefined): string | undefined {
  // Not `Array.isArray`, which widens a `readonly string[]` to `any[]` and takes the whole
  // function with it. A string is a string; anything else that is present is the array form.
  const value = typeof raw === 'string' ? raw : raw?.at(0)
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > MAX_ID_LENGTH || !SAFE_ID.test(trimmed)) return undefined
  return trimmed
}
