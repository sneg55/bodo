// A rich-text biography, seen through a plain textarea.
//
// The speaker writes their biography in TipTap and it is stored as HTML. The organizer's
// edit sheet is a plain `Textarea`, so that HTML arrived in it as literal markup: a
// biography reading `<p>Ada builds...</p>` on screen, which an organizer would then either
// leave alone in confusion or "fix" by deleting the tags.
//
// The other half of the same problem is invisible until somebody saves: text typed into a
// textarea and stored straight into that column is a biography with no paragraphs at all,
// wherever it is rendered as HTML.
//
// So the sheet reads through `bioToText` and writes through `textToBioHtml`, and it only
// writes when the organizer actually TOUCHED the field. Untouched, the speaker's own markup
// goes back exactly as it came, which is what makes this safe: an organizer correcting a job
// title does not silently flatten somebody's formatting.

/** How the stored biography reads in a plain textarea. */
export function bioToText(html: string): string {
  if (html.trim() === '') return ''

  return (
    html
      // Block boundaries become line breaks BEFORE the tags are stripped, or every
      // paragraph runs into the next one and the organizer sees a wall of text.
      .replaceAll(/<\s*br\s*\/?>/giu, '\n')
      .replaceAll(/<\/\s*(?:p|div|li|h[1-6]|blockquote)\s*>/giu, '\n\n')
      .replaceAll(/<[^>]*>/gu, '')
      .replaceAll('&nbsp;', ' ')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      // Last, so an entity that decodes to `&` cannot be re-read as the start of another.
      .replaceAll('&amp;', '&')
      .replaceAll(/[ \t]+/gu, ' ')
      .replaceAll(/\n{3,}/gu, '\n\n')
      .trim()
  )
}

/**
 * Plain text back to the paragraph markup every reader of this column expects.
 *
 * Escaped on the way in, because this is stored as HTML and rendered as HTML: an organizer
 * who types `<b>` into the box is typing four characters, not a tag, and a biography is one
 * of the strings that reaches an email body.
 */
export function textToBioHtml(text: string): string {
  const trimmed = text.trim()
  if (trimmed === '') return ''

  return trimmed
    .split(/\n{2,}/u)
    .map((block) => {
      const escaped = block
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        // Single newlines inside a paragraph are line breaks, not paragraph breaks. Done
        // after escaping so the tag being inserted is not escaped along with the text.
        .replaceAll('\n', '<br>')
      return `<p>${escaped}</p>`
    })
    .join('')
}
