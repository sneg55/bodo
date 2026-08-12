// How organizer-authored HTML gets rendered to a speaker without becoming a script in
// the speaker's session.
//
// `Resources.embedHtml` is raw markup an organizer pastes in, and rendering it is the
// whole point of R8 ("HTML embed support so existing reference material can be dropped
// in"). So this is a stored-XSS surface by construction and it cannot be closed by
// refusing to render HTML. Three options were on the table:
//
//   1. Sanitize before storage. Cheapest to render, worst to live with: the stored value
//      is no longer what the organizer wrote, so an embed that a later sanitizer version
//      would have allowed is gone for good, and there is no way to re-render it.
//   2. Sanitize before render. Keeps the source, but the defense is then exactly as good
//      as the sanitizer's blocklist, and it has to STRIP the very things an embed needs:
//      a YouTube or Google Maps embed is an `<iframe>`, an analytics or slide embed is a
//      `<script>`. A sanitizer strict enough to be a defense breaks the feature; one
//      loose enough to keep the feature is not a defense.
//   3. Isolate at render. The markup is handed verbatim to an `<iframe srcdoc>` whose
//      `sandbox` attribute omits `allow-same-origin`, so it runs in an OPAQUE origin.
//
// Option 3 ships, because its guarantee does not depend on anybody's blocklist being
// complete. It is also what BUILD_SPEC 5.8 asks for, with one deliberate deviation
// recorded below.
//
// WHAT THE SANDBOX ACTUALLY BUYS. With `sandbox` present and `allow-same-origin` absent,
// the frame's document is assigned a unique opaque origin. Script inside it therefore
// cannot touch `window.parent`'s DOM, cannot read the session cookie (it is HttpOnly as
// well, but this holds even if it were not), cannot read `localStorage` or IndexedDB for
// the app origin, and cannot issue same-origin credentialed requests to `/api/*` as the
// signed-in speaker. Scripts still RUN, which is required for a real embed to work.
//
// WHERE IT DEVIATES FROM BUILD_SPEC 5.8. That section says
// `sandbox="allow-scripts allow-same-origin"`. Those two flags together are a documented
// footgun and not a sandbox at all: with both set, the frame is same-origin with the
// embedder, so script inside it can reach `parent.document` and can even remove the
// `sandbox` attribute from its own iframe element and reload itself unsandboxed. Adding
// `allow-same-origin` would have made this file decorative. It is omitted.
//
// WHAT IT DOES NOT BUY, stated plainly rather than implied:
//   - It is not a content guarantee. An organizer can still embed something that shows a
//     speaker a fake login form or a full-frame advert, and the frame can navigate itself
//     anywhere. The trust boundary is "an authorized organizer of this event", enforced
//     on the write (see ./actions.ts), not on the markup.
//   - `allow-popups` is granted, so the frame can open a new tab. The opened tab inherits
//     the sandbox, because `allow-popups-to-escape-sandbox` is NOT granted.
//   - Script inside the frame can still make cross-origin requests to the wider internet.
//     Blocking that would need a CSP on the frame document, which would also break every
//     legitimate third-party embed, so it is not attempted.
//   - Nothing here validates that the markup is well-formed. A broken tag renders broken,
//     inside the frame, which is the correct blast radius.
//
// The rendering itself is in ./ResourceEmbed.tsx. Keeping the constants and the document
// wrapper here, with no JSX, is what lets tests/resources-embed.test.ts assert the
// security properties directly instead of inferring them from a screenshot.

import { safeHttpUrl } from '@/components/primitives/rich-text-html'

/**
 * The sandbox token list, as one string, so there is exactly one place it is spelled.
 *
 * `allow-scripts` is what makes a real embed work. `allow-forms` lets an embedded
 * registration or survey widget submit. `allow-popups` lets a link inside the frame open
 * a tab. `allow-same-origin` is deliberately, permanently absent: see the header. Adding
 * it, or adding `allow-popups-to-escape-sandbox`, undoes the isolation this whole module
 * exists to provide, which is why the token list is asserted by a test rather than only
 * by a comment.
 */
export const EMBED_SANDBOX = 'allow-scripts allow-forms allow-popups'

/**
 * A fixed frame height, in Tailwind units.
 *
 * BUILD_SPEC 5.8 describes a "fixed height field". There is no height column on
 * `Resources` (src/migrations/tables-portal.ts), and adding one is a schema migration
 * that this change is not making, so the height is fixed in CSS for every embed and the
 * frame scrolls internally. A cross-origin frame cannot be measured from the parent, so
 * auto-sizing is not available without the frame cooperating, which third-party markup
 * will not do.
 */
export const EMBED_HEIGHT_CLASS = 'h-[32rem]'

/** True when there is markup worth rendering a frame for. */
export function hasEmbed(html: string | undefined): boolean {
  return html !== undefined && html.trim() !== ''
}

/** The accessible name for the frame. `<iframe title>` is required, not a tooltip. */
export function embedTitle(resourceTitle: string): string {
  const trimmed = resourceTitle.trim()
  return trimmed === '' ? 'Embedded content' : `${trimmed}: embedded content`
}

/** At most this many addresses under the frame. A caption, not a link farm. */
const EMBED_SOURCE_LIMIT = 3

/** Only `src` and `href`, because those are the two that fetch or navigate. */
const EMBED_URL_ATTRIBUTE = /(?:src|href)\s*=\s*["']([^"']+)["']/giu

/**
 * The addresses an embed points at, for the caption under the frame.
 *
 * **The frame cannot be asked whether it worked.** It is a cross-origin document by
 * construction (no `allow-same-origin`, see the header), so a map whose tiles were blocked
 * and a map that rendered are the same opaque rectangle from out here, and there is no
 * load event that distinguishes them: `srcdoc` fires `onload` as soon as OUR wrapper
 * parses, whatever the third party inside it then fails to do. So the fallback is not
 * detected, it is always shown: a reader looking at a blank rectangle gets told what was
 * supposed to be there and where to reach it, and a reader looking at a working embed gets
 * one muted line naming its source.
 *
 * Scanned for two attributes rather than parsed. The Worker has no DOM, and a parser
 * dependency to read `src` and `href` for a caption is not a trade worth making; a missed
 * URL costs the generic line rather than anything incorrect. Every candidate goes through
 * the shared `safeHttpUrl`, so a `javascript:` href in organizer markup can never become
 * an anchor on the speaker's page, and `&amp;` is decoded because the value is read out of
 * attribute source rather than off a parsed DOM.
 */
export function embedSources(html: string): readonly string[] {
  const found: string[] = []
  // `exec` in a loop rather than `matchAll`, because the pattern is `g` and one shared
  // regex object carries `lastIndex` between calls; it is reset below so a second call
  // cannot start where the first one stopped.
  EMBED_URL_ATTRIBUTE.lastIndex = 0

  let match = EMBED_URL_ATTRIBUTE.exec(html)
  while (match !== null && found.length < EMBED_SOURCE_LIMIT) {
    const url = safeHttpUrl(match[1].split('&amp;').join('&'))
    if (url !== undefined && !found.includes(url)) found.push(url)
    match = EMBED_URL_ATTRIBUTE.exec(html)
  }

  return found
}

/**
 * The host, for the caption's link text. A whole tracking URL is not a label.
 *
 * `URL` is available in the Workers runtime and in Node, and the input has already passed
 * `safeHttpUrl`, so the parse cannot realistically throw; the raw string is returned if it
 * somehow does, because a caption is not worth a 500.
 */
export function embedHostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, '')
  } catch {
    return url
  }
}

/**
 * The organizer's markup, wrapped in a minimal document.
 *
 * The payload is inserted VERBATIM. That is the design, not an oversight: this module
 * isolates rather than sanitizes, and a half-hearted strip here would create the false
 * impression that the frame's contents had been vetted.
 *
 * The wrapper adds only what a fragment cannot do for itself. A charset, because the
 * srcdoc document does not inherit the parent's encoding and a pasted `—` would otherwise
 * render as mojibake. `color-scheme`, so a dark-mode viewer does not get a white slab.
 * A base font and zero body margin, because the frame gets none of the app's CSS: it is
 * a different origin, which is the point.
 */
export function embedDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${EMBED_STYLE}</style></head><body>${html}</body></html>`
}

/**
 * The frame's own stylesheet, and the last two rules are a bug fix rather than polish.
 *
 * The outer frame is a fixed `EMBED_HEIGHT_CLASS` (32rem) and cannot be auto-sized, for the
 * reason given there. A pasted embed brings its own height instead: OpenStreetMap's share
 * markup carries `height="350"`, YouTube's carries 315. So the frame was 512px tall, the
 * embed inside it was 350px tall, and the remaining ~160px was empty background inside a
 * bordered box. It read as a broken embed rather than as a fixed-height one.
 *
 * `flex:1 0 auto` on the embed is the whole of it: grow into whatever the frame has spare,
 * and NEVER shrink. The no-shrink half matters as much as the grow: an embed taller than the
 * frame keeps its own height and the frame scrolls, which is the behaviour
 * `EMBED_HEIGHT_CLASS` promises. `min-height` rather than `height` on the body is the same
 * decision one level up.
 *
 * It reaches `body > iframe` only. A script-built widget that renders into a `div` is left
 * alone, because nothing here knows what shape it wants, and a stray rule on every element
 * is how a third party's own layout gets broken from outside.
 */
const EMBED_STYLE = [
  ':root{color-scheme:light dark}',
  'html{height:100%}',
  'html,body{margin:0;padding:0}',
  'body{min-height:100%;display:flex;flex-direction:column}',
  'body{font:14px/1.5 ui-sans-serif,system-ui,sans-serif}',
  'img,video,iframe{max-width:100%}',
  'body>iframe{flex:1 0 auto;width:100%}',
].join('')
