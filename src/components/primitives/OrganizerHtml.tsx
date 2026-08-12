// Organizer-authored rich text, rendered as HTML. One component for every place stored HTML from
// an organizer's editor reaches a reader, so there is one sink and one note saying why.
//
// It lives here, and not beside the CFP wizard where it started, because the speaker portal needs
// it too: a portal form's instructions had the same shape and the same trust question. A route
// directory holds routes, so a feature importing a component out of `src/app` was backwards.
//
// It is set with `dangerouslySetInnerHTML` because the builder's editor produces markup
// (headings, bold, lists, links) and escaping it would render the tags. The value arrives already
// SANITIZED, by `mapForm` in src/services/airtable/mapping-forms.ts, which is the read boundary.
//
// The sanitize call briefly lived HERE and had to move: this component is reached from the
// wizard's client components, so calling it here shipped sanitize-html and postcss to the browser
// and still left the raw markup in the RSC payload. Do not add it back; add a column to the
// mapper instead.
//
// This comment used to argue the sink was safe by authorship: the only writer is an
// authenticated event admin editing their own event, so the same trust level as the admin
// surface. Codex review showed that reasoning is wrong twice over. An event admin is a customer
// rather than the operator, so running script in a PUBLIC visitor's session crosses a real
// boundary. And the old comment's proposed remedy, a sanitizer at the write boundary in the
// builder, does not work: the editor's button guards and TipTap's parse rules are irrelevant to
// a value typed straight into the Airtable cell. The value is untrusted when it is read.
//
// It is still NOT speaker input, and no submitted answer is ever rendered this way.
//
// Renders nothing at all for an empty body, which is what keeps an unwritten description from
// leaving an empty paragraph on the page. `blankToUndefined` already stops `<p></p>` reaching
// the column; this is the render-time half of the same rule, for the rows that predate it.
//
// It calls the SAME predicate as the write side rather than repeating the regex, which is the
// bug that was here: both sides stripped tags and tested the remainder, so once the toolbar
// gained an image button a body of exactly one `<img>` read as empty in both places and an
// image-only description was discarded on save and suppressed on render.

import { RICH_TEXT_PROSE } from '@/components/primitives/rich-text-prose'
import { isBlankRichText } from '@/features/forms/builder/emptiness'
import { cn } from '@/utils/cn'

/**
 * How stored prose breaks its lines.
 *
 * `text-wrap` is inherited, so `text-pretty` on the wrapper reaches every paragraph, list
 * item and blockquote inside the markup without a rule per tag, and stops the last line of
 * each ending on one orphaned word. Headings are the case `pretty` does not cover: they are
 * short enough for the balancing pass, which evens the lines out instead.
 *
 * It belongs in RICH_TEXT_PROSE beside the rest of the shared prose rules, exactly so the
 * two sinks cannot drift. That file was out of scope for this pass, so the identical string
 * sits on both for now.
 */
const RICH_TEXT_WRAP = 'text-pretty [&_h1]:text-balance [&_h2]:text-balance [&_h3]:text-balance'

export function OrganizerHtml({ html }: { html: string | undefined }) {
  if (html === undefined || isBlankRichText(html)) return null
  return (
    <div
      className={cn(RICH_TEXT_PROSE, RICH_TEXT_WRAP)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
