// The two letters an avatar falls back to when there is no headshot.
//
// One implementation, because there were four and they did not agree about the case that
// matters. `features/crm/speaker-rows.ts` and `features/cms/speakers.ts` end at `'?'`;
// `features/speakers/admin-roster.ts` and `features/portal/identity.ts` ended at
// `email.charAt(0)`, which is `''` for a row whose three name-ish columns are all blank,
// and an `AvatarFallback` handed `''` renders a circle with nothing in it. `mapSpeaker`
// defaults `firstName` and `lastName` to `''` and an imported or hand-created Speakers row
// can carry a space in every one of them, so that is a reachable row rather than a
// defensive flourish: a blank circle is unreadable and, in a list of same-named duplicates,
// unidentifiable.
//
// The rule: the initials of whichever name halves exist, and ONLY when there are none, the
// first letter of the email, and `'?'` when even that is empty.
//
// The email is a fallback, not a filler. The CRM's version concatenated all three sources
// and took the first two letters, so Ada with no surname and `ada@example.com` rendered
// `AA`: the address quietly stood in for the missing family name and printed a letter the
// person does not have. Caught by `tests/portal-roster-identity.test.ts`, which had pinned
// the portal's stricter behaviour ("uses one initial when only one name is set") before
// these four implementations were merged. One initial is the honest answer there.

/** Two letters at most, so a long name does not overflow the circle. */
const MAX_LETTERS = 2

/**
 * Loose on purpose. A `Speaker` satisfies it, so does a participant row's resolved
 * speaker, and so does a half-built draft in an import preview.
 */
export type InitialsSource = {
  readonly firstName?: string
  readonly lastName?: string
  readonly email?: string
}

export function speakerInitials(source: InitialsSource): string {
  const fromName = [source.firstName, source.lastName]
    .map((part) => (part ?? '').trim().at(0) ?? '')
    .join('')
    .slice(0, MAX_LETTERS)
    .toUpperCase()
  if (fromName !== '') return fromName

  // Only now. A speaker created by a CFP submit that captured an address and nothing else
  // has no name until they open their profile, and one letter beats an empty circle.
  const fromEmail = ((source.email ?? '').trim().at(0) ?? '').toUpperCase()
  return fromEmail === '' ? '?' : fromEmail
}
