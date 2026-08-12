// How long an answer is, in the characters a person would count.
//
// Split out of logic.ts when that file crossed the size limit, and it is one concern: the
// wizard's live counter, the combined counter and the server's `checkAnswer` all measure
// through `answerLength`, because a speaker shown a number under the cap and then refused on
// submit for being over it is the disagreement this single function exists to prevent.
// `logic.ts` re-exports it, so nothing had to change import.

/**
 * A start or end tag, which is what tells editor markup from text that merely contains a
 * `<`. Stricter than "anything between angle brackets" by one character, the letter a tag
 * name has to start with: a speaker writing `if a < b then` has not written HTML, and
 * charging them for characters they cannot see is the defect this exists to avoid.
 */
const HTML_TAG = /<\/?[a-z][^>]*>/iu

/** The same, for stripping rather than detecting. Separate because a global regex is stateful. */
const EVERY_HTML_TAG = /<\/?[a-z][^>]*>/giu

/** The tags that render as a line break, which IS a character the speaker put there. */
const BREAK_TAGS: readonly RegExp[] = [/<br\s*\/?>/giu, /<\/(?:p|div|li|h[1-6]|blockquote|tr)>/giu]

/** The five XML entities plus `&nbsp;`, each of which is ONE character to a reader. */
const ENTITIES: readonly (readonly [RegExp, string])[] = [
  [/&lt;/gu, '<'],
  [/&gt;/gu, '>'],
  [/&quot;/gu, '"'],
  [/&#0?39;|&apos;/gu, "'"],
  [/&nbsp;/gu, ' '],
  [/&amp;/gu, '&'],
]

/**
 * What a markup answer costs, in the characters a person would count.
 *
 * A rich text answer is stored as the HTML TipTap emits, and that markup is not something
 * the speaker typed or can see: a 38 character abstract read "45 / 5,000" the moment it was
 * wrapped in a paragraph, and every formatting button pushed the number further from the
 * text. So block tags count as the line breaks they render as, entities as the single
 * characters they decode to, and everything else in a tag as nothing.
 */
function markupLength(value: string): number {
  if (!HTML_TAG.test(value)) return value.length
  const broken = BREAK_TAGS.reduce((carried, tag) => carried.replace(tag, '\n'), value)
  const text = ENTITIES.reduce(
    (carried, [pattern, replacement]) => carried.replace(pattern, replacement),
    broken.replace(EVERY_HTML_TAG, ''),
  )
  return text.replace(/\n{3,}/gu, '\n\n').trim().length
}

/**
 * The field types whose stored value IS markup, and therefore the only ones measured as
 * text rather than verbatim.
 *
 * The distinction is load-bearing rather than tidy, and its absence was a real hole:
 * measuring EVERY string as text let any field be filled past its cap, because the tag
 * pattern accepts a tag name followed by anything up to the next `>`. So
 * `"<x " + "a".repeat(6000) + ">"` is one "tag" 6,004 characters long, it stripped to
 * nothing, `answerLength` returned 0, and a 5,000 character cap passed on the counter AND on
 * the server. Found by Codex review; `tests/forms-answer-length-html.test.ts` holds the case.
 *
 * Bounding the tag pattern does not fix that, which is why this is a type check instead:
 * whatever bound is chosen, the same shape repeated under it strips to nothing just as well.
 * What actually separates the two cases is the FIELD, not the value. A speaker typing angle
 * brackets into a plain text box has not written HTML and is charged for every character;
 * a rich text answer is the editor's own output, and charging for its tags is the defect the
 * text measurement exists to avoid.
 */
const MARKUP_TYPES: readonly string[] = ['wysiwyg', 'speaker_bio']

/**
 * Characters an answer contributes to a `maxLen` or a combined limit. Untrimmed,
 * because the wizard's live counter counts what the speaker actually typed.
 *
 * `type` is optional and its ABSENCE means verbatim, deliberately: a caller that does not
 * know the field counts every character, which refuses an over-long answer rather than
 * accepting one. The unsafe default would be the other way round.
 */
export function answerLength(answer: unknown, type?: string): number {
  if (typeof answer === 'string') {
    return type !== undefined && MARKUP_TYPES.includes(type) ? markupLength(answer) : answer.length
  }
  if (Array.isArray(answer)) {
    const items: readonly unknown[] = answer
    return items.reduce<number>((sum, item) => sum + answerLength(item, type), 0)
  }
  if (typeof answer === 'number' || typeof answer === 'boolean') return String(answer).length
  return 0
}
