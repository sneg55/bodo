// The two ways an editor's empty string becomes absence, shared by `draft.ts` and
// `headings.ts` so the rich-text rule is written once.
//
// Split out rather than duplicated because the rich-text rule is not obvious and a second
// copy of it would drift: the whole point is that markup which LOOKS non-empty is empty.

import { isBlankRichText } from '@/features/forms/builder/emptiness'

/**
 * Absent when there is nothing in it, including when it is empty RICH TEXT.
 *
 * TipTap represents a cleared editor as `<p></p>`, which is not whitespace, so deleting
 * every character of a welcome message used to store that markup: the form reloaded with
 * "Show message" still on and the public wizard's own default welcome copy suppressed by an
 * empty paragraph. Found by Codex review. The emptiness rule itself now lives in
 * `./emptiness.ts`, because the RENDER side needs the same answer and used to carry its own
 * copy of it. The ORIGINAL value is returned when it is not empty, because the markup is the
 * content and trimming it would edit the organizer's HTML.
 */
export function blankToUndefined(value: string): string | undefined {
  return isBlankRichText(value) ? undefined : value
}

/**
 * The plain-text counterpart, for a heading or a title.
 *
 * Deliberately NOT `blankToUndefined`: this trims what it stores, which is right for a
 * one-line input and wrong for markup, where trimming would edit the organizer's HTML.
 */
export function trimToUndefined(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}
