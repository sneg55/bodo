// The speaker tag vocabulary, as rules: what a tag may be called, and what colour it may be.
//
// Pure, so `tests/crm-tag-vocabulary.test.ts` asserts it without a base. It exists because
// the tag editor on the profile and the Server Action behind it must agree about both
// questions, and a check that lives only in the dialog is a check anybody can POST past.

import type { SpeakerTag } from '@/types/domain'

/**
 * A tag name is a chip. 60 rather than the 255 a list name gets, because it renders inline
 * beside other chips rather than in a dropdown row of its own, and a paragraph-length tag
 * would push every other chip on a speaker off the card.
 */
export const SPEAKER_TAG_NAME_MAX = 60

/**
 * The colours a new tag may be given.
 *
 * A FIXED PALETTE rather than a hex field, and the reason is legibility, not security. An
 * earlier version of this comment claimed the palette kept "stored client input out of a
 * style attribute"; that framing does not survive checking. React's object form of `style`
 * assigns through CSSOM, which drops a value that is not a colour, and `mapSpeakerTag`
 * passes whatever text is in the Airtable cell through unvalidated anyway, so the palette
 * defends nothing this write path controls.
 *
 * What it actually buys: every chip in the vocabulary is drawn from one ramp, so a swatch
 * carries meaning instead of being nine unrelated hues an organizer picked on nine
 * different days; and the check is set membership rather than a hex regex, which cannot be
 * subtly wrong.
 *
 * The values are the Tailwind 500 ramp, which is where the rest of the app's accent tones
 * come from, and the first is the same slate `mapSpeakerTag` falls back to for a row created
 * outside the app, so a hand-made tag sits in the palette rather than beside it.
 *
 * Names are AUTHORED. The parity report waives the whole CRM area (it appears in no
 * screenshot), so there is nothing to transcribe; they are the plain colour words an
 * organizer would use out loud.
 */
export const SPEAKER_TAG_COLORS: readonly { value: string; label: string }[] = [
  { value: '#64748b', label: 'Slate' },
  { value: '#ef4444', label: 'Red' },
  { value: '#f97316', label: 'Orange' },
  { value: '#eab308', label: 'Yellow' },
  { value: '#22c55e', label: 'Green' },
  { value: '#06b6d4', label: 'Cyan' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#a855f7', label: 'Purple' },
  { value: '#ec4899', label: 'Pink' },
]

export function isSpeakerTagColor(value: string): boolean {
  return SPEAKER_TAG_COLORS.some((choice) => choice.value === value)
}

/**
 * The colour a new tag gets when the caller does not pick one.
 *
 * Cycles the palette by how many tags already exist, rather than defaulting everything to
 * slate. A colour is the whole point of a chip: nine identical grey chips carry no more
 * information than nine unlabelled ones, and the editor deliberately does not ask for a
 * colour because it is one field standing between an organizer and the tag they are trying
 * to make. Deterministic, so a vocabulary built in the same order looks the same twice, and
 * it never fails: the palette is a non-empty literal, and `.at()` on a modulo index cannot
 * miss, so the `??` below is only there to satisfy the compiler's read of `.at()`.
 */
export function nextTagColor(existing: readonly SpeakerTag[]): string {
  const index = existing.length % SPEAKER_TAG_COLORS.length
  return SPEAKER_TAG_COLORS.at(index)?.value ?? '#64748b'
}

function normalized(name: string): string {
  return name.trim().toLocaleLowerCase()
}

/**
 * Why a tag name cannot be used, or that it can.
 *
 * The vocabulary is GLOBAL, not event-scoped (`speakerTagsTag()` takes no argument), so the
 * duplicate check runs against every tag in the base. That is the point of the table: two
 * organizers who both create "Keynote" would be labelling the same people with two chips
 * that mean the same thing, and the directory would filter on one of them.
 */
export function checkTagName(
  name: string,
  existing: readonly SpeakerTag[],
): { ok: true } | { ok: false; reason: string } {
  const trimmed = name.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'Enter a name for this tag.' }
  if (trimmed.length > SPEAKER_TAG_NAME_MAX) return { ok: false, reason: 'That name is too long.' }

  const clash = existing.some((tag) => normalized(tag.name) === normalized(trimmed))
  return clash ? { ok: false, reason: 'A tag called that already exists.' } : { ok: true }
}

/**
 * The tag ids a write may actually apply: those the vocabulary knows, deduplicated, in the
 * vocabulary's own order.
 *
 * `setSpeakerTags` walks every SpeakerTags row and patches the ones whose membership should
 * change, so an id outside the vocabulary is already ignored there. Narrowing here as well
 * is not belt and braces: it is what lets the action report a stale editor honestly instead
 * of silently dropping half of what was asked for, and it fixes the ORDER, so the write is
 * the same whatever order the chips were clicked in.
 */
export function knownTagIds(
  tagIds: readonly string[],
  vocabulary: readonly SpeakerTag[],
): readonly string[] {
  const wanted = new Set(tagIds)
  return vocabulary.filter((tag) => wanted.has(tag.id)).map((tag) => tag.id)
}

/**
 * The whole tag set after toggling one tag on or off `current`.
 *
 * Extracted out of the editor's click handler so the thing that makes a double-click
 * DESTRUCTIVE can be asserted without a React renderer. `setSpeakerTags` REPLACES membership
 * rather than diffing it (mutations-crm.ts), so the write is only ever as correct as the
 * `current` it was computed from. Two toggles computed from the SAME `current` therefore
 * produce two sets that each discard the other's change, and the second one to land wins:
 * `tests/crm-tag-vocabulary.test.ts` pins exactly that, so the reason the editor has to
 * serialise its writes is written down rather than remembered.
 *
 * The serialisation itself lives in `SpeakerTagEditor` and is not unit-testable here: it is
 * React transition scheduling, and this repo's vitest environment is `node` with no
 * renderer. See the task report.
 */
export function nextTagIds(current: readonly SpeakerTag[], tagId: string): readonly string[] {
  const ids = current.map((tag) => tag.id)
  return ids.includes(tagId) ? ids.filter((id) => id !== tagId) : [...ids, tagId]
}
