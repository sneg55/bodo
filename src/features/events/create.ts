// Creating an event, as pure functions: the blank draft and the slug suggestion.
//
// **Why this reuses `EventDetailsDraft` rather than defining a create-specific shape.**
// The create form asks for exactly what Event Settings > Event Details asks for, so a
// second type would be the same eleven fields with a second set of validation rules that
// drift from `checkEventDetails`. Sharing the draft means the create page and the settings
// page cannot disagree about what a valid slug is, and it is why `EventDetailsGrid`
// renders both.
//
// **Two fields are deliberately absent from the create flow**, and neither is an omission:
//
// - The images. `setEventImage` writes a URL that the upload route derived from an object
//   key it built out of an event id, so there is no key to build before the record exists.
//   The draft carries empty strings and the organizer sets them in Settings, on the same
//   surface where every other image on the event is set.
// - `status`. A new event is `draft` and nothing on this form should be able to say
//   otherwise: `open` means the CFP accepts submissions, and an event with no form and no
//   tracks yet cannot accept anything. Settings is where it opens.
//
// Nothing here is transcribed. `docs/parity/event-config.md` covers the settings screen
// only, and all 40 reference screenshots were taken from inside one event with the switcher
// never captured open, so the reference says nothing about how an event begins. This is
// authored, and per the exception recorded in SPEC.md that is allowable here because the
// surface it reuses is captured: this is the interior of a flow whose outside is known.

import type { EventDetailsDraft } from '@/features/settings/draft'
import { SLUG_MAX_LENGTH } from '@/features/settings/draft'

/**
 * The zone a brand new event starts in.
 *
 * UTC rather than the organizer's own zone, and it is a real tradeoff rather than
 * laziness. The server has no useful zone to offer: on Workers `resolvedOptions().timeZone`
 * is UTC, so it cannot render the browser's. Reading the browser's during hydration would
 * mismatch whatever the server rendered, and setting it from an effect is the synchronous
 * setState that `react-hooks/set-state-in-effect` bans. So the honest default is the one
 * that is obviously wrong when it is wrong, which is the same reasoning `mapEvent` uses for
 * a blank timezone column, and the picker sits directly under the field.
 */
export const DEFAULT_NEW_EVENT_TIMEZONE = 'UTC'

/** A new event accepts nothing until Settings opens it. See the header. */
export const NEW_EVENT_STATUS = 'draft'

/**
 * An empty Event Details draft.
 *
 * `eventType` is seeded with the first option rather than left blank, because the control
 * is a `Select` over a closed vocabulary and an empty one would offer a twelfth state that
 * `EVENT_TYPE_OPTIONS` does not contain and the Airtable column would answer with a 422.
 */
export function blankEventDraft(timezone: string = DEFAULT_NEW_EVENT_TIMEZONE): EventDetailsDraft {
  return {
    name: '',
    slug: '',
    eventType: 'Conference',
    websiteUrl: '',
    location: '',
    timezone,
    startsAt: undefined,
    endsAt: undefined,
    theme: '',
    logoUrl: '',
    backgroundUrl: '',
  }
}

/**
 * A slug proposed from the event's name, so the field fills itself while the organizer
 * types and they only touch it to disagree.
 *
 * A SUGGESTION, never a substitute for the check. It can return a value
 * `checkEventDetails` rejects (an empty string for a name of only punctuation, or a
 * two-character result under `SLUG_MIN_LENGTH`), and that is correct: the form should say
 * so rather than silently invent a slug that will sit in a public URL forever. What it
 * guarantees is the charset and hyphen shape `isSlugShaped` wants, so a suggestion is
 * never rejected for a reason the organizer cannot see in the box.
 *
 * Truncation happens before the trailing hyphen is stripped, so cutting mid-word at the
 * limit cannot leave a slug ending in `-`.
 */
export function suggestSlug(name: string): string {
  const ascii = name
    .normalize('NFKD')
    // Combining marks, so `Café` yields `cafe` rather than losing the whole word.
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()

  return collapseHyphens(ascii.replace(/[^a-z0-9]+/gu, '-'))
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/u, '')
}

/** Runs of separators become one hyphen, and the ends carry none. */
function collapseHyphens(value: string): string {
  return value.replace(/-{2,}/gu, '-').replace(/^-+/u, '').replace(/-+$/u, '')
}

/**
 * The slug a name change should drag along with it, or nothing.
 *
 * The create form fills the slug from the name until the organizer edits the slug, and then
 * never again. Pure and here rather than inside the component because it is three rules
 * that are all easy to get subtly wrong and impossible to see going wrong:
 *
 * - Once touched, the name never overwrites it. A latch that reset would mean correcting a
 *   typo in the name silently discards a slug the organizer chose on purpose.
 * - A patch that sets the slug is never second-guessed, including the very edit that sets
 *   the latch, which arrives in the same call.
 * - An empty suggestion is not applied. Clearing the name to retype it would otherwise wipe
 *   a visible slug mid-keystroke, which reads as the form losing work.
 */
export function slugToFollow(
  patch: { name?: string; slug?: string },
  slugTouched: boolean,
): string | undefined {
  if (slugTouched || patch.slug !== undefined || patch.name === undefined) return undefined
  const suggested = suggestSlug(patch.name)
  return suggested === '' ? undefined : suggested
}
