// Is this rich text empty? One answer, shared by the write boundary (`text.ts`, and through
// it `draft.ts` and `headings.ts`) and the render boundary (`OrganizerHtml`).
//
// Split from `text.ts` so the RENDER side can import the rule without importing the builder's
// write helpers, which is what let the two drift in the first place: they were the same regex
// written twice, and only one of them was ever updated.
//
// The rule is not "does it contain text", it is "does it contain anything a reader would see".
// Those differed the moment the toolbar gained an image button: stripping tags and testing the
// remainder reports a body of exactly one `<img>` as empty, so an image-only welcome message
// was discarded on save AND suppressed on render. Nothing errored, which is why it needed
// finding rather than fixing.

/**
 * Elements that ARE content even with no text in them.
 *
 * Deliberately a small closed list rather than "any tag with no closing pair": an `<img>` and
 * an `<hr>` are things a reader sees, while the `<p>` and `<br>` TipTap leaves behind when an
 * editor is cleared are not. `<iframe>` and `<video>` are absent because this editor cannot
 * insert them; if one ever can, it belongs here and the test below will not catch its absence.
 */
const VISIBLE_VOID = /<\s*(?:img|hr)\b/iu

/**
 * The same tag list as a value, so a test can assert the two agree rather than restating the
 * pattern. Built from the literal above and not the other way round: a `RegExp` composed from
 * an array is a non-literal constructor, which the security lint rule refuses here.
 */
export const VISIBLE_VOID_TAGS = ['img', 'hr'] as const

/**
 * True when the markup would render nothing a reader could see.
 *
 * `&nbsp;` survives tag stripping and is what an editor leaves behind on some paths, so it is
 * normalised to a space before the test rather than counted as content.
 */
export function isBlankRichText(value: string): boolean {
  if (VISIBLE_VOID.test(value)) return false
  const text = value
    .replace(/<[^>]*>/gu, '')
    .replaceAll('&nbsp;', ' ')
    .trim()
  return text.length === 0
}
