// The one rule over an admin's own display name.
//
// Pure and separate from the action for the reason `members.ts` gives about the duplicate
// address check: a rule that decides what lands in a column read by every admin surface
// should be exercised by a test rather than only by clicking. This one is small, and the
// interesting half is what it deliberately does NOT refuse.
//
// A blank name is ALLOWED, and that is the decision on this surface. Every `AdminUsers` row
// starts with an address and no name, because `createAdminUser` writes only the address, so
// blank is not an error state the product is trying to get out of: it is where everybody
// begins, and the surfaces already handle it (`actingUserOf` shows the address, the team
// table shows "No name yet"). Refusing to clear a name would mean the one thing an organizer
// could not do on a page about their own name is undo it.
//
// What it does refuse is a name that would make the surfaces lie: something longer than the
// column can usefully render, or a value that is only whitespace pretending to be a name.
// The second is why the collapse happens before the length check rather than after.

import type { TeamProblem } from '@/features/team/members'

/**
 * The practical limit of a display name, not Airtable's.
 *
 * The value is rendered in a 224px dropdown, an avatar tooltip and a table cell that all
 * truncate, so anything past this is invisible everywhere it appears while still being
 * stored, mailed and sorted on. Matched to nothing in the schema on purpose: a long-text
 * column has no limit to inherit.
 */
export const PROFILE_NAME_MAX_LENGTH = 100

/**
 * Trimmed, with internal runs of whitespace collapsed to one space.
 *
 * The collapse is what makes `"  "` and `"A    B"` comparable to the values the rest of the
 * app derives from a name: `actingInitials` splits on whitespace and takes the first letter
 * of the first two words, so a double space between forename and surname is invisible in the
 * avatar and visible in the table. Storing the collapsed form means the two agree.
 */
export function normalizeProfileName(raw: string): string {
  return raw.trim().replace(/\s+/gu, ' ')
}

/**
 * Whether a name may be stored. `undefined` means yes, blank included.
 *
 * Checked against the NORMALIZED value, so a hundred-character name padded with spaces is
 * accepted rather than refused for a length it does not really have.
 */
export function checkProfileName(raw: string): TeamProblem | undefined {
  const name = normalizeProfileName(raw)
  if (name.length > PROFILE_NAME_MAX_LENGTH) {
    return { message: `That name is too long (limit ${PROFILE_NAME_MAX_LENGTH} characters).` }
  }
  return undefined
}
