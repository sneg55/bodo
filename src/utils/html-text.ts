// Flatten stored markup to prose.
//
// The counterpart to `safe-html.ts`, and the two answer different questions. That one asks
// "may this be rendered as HTML", runs on the server, and carries a parser. This one asks
// "what does it SAY", is a handful of regexes, and is safe to ship to a browser: it produces
// a string that is then rendered as TEXT by React, so nothing here is a sink.
//
// It lived in `features/portal/answers-view.ts`, whose other exports pull in the field
// registry and the submission column map. Moving it here is what lets the PUBLIC CFP wizard
// use it from a client component without dragging any of that into the wizard's chunk. That
// wizard's Review step is the reason: it printed a speaker their own abstract as
// `<p>Our monorepo CI took 40 minutes...</p>`, tags and all, as their last look before
// submitting.

/**
 * Block-level tags become newlines, everything else is dropped, and the five XML
 * entities are decoded last so a `&lt;script&gt;` in the source stays literal text.
 */
export function htmlToText(html: string): string {
  if (!html.includes('<')) return decodeEntities(html)
  const withBreaks = html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|blockquote|tr)\s*>/gi, '\n')
  return decodeEntities(withBreaks.replace(/<[^>]*>/g, ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}
