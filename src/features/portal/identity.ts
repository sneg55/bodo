// Display identity for the portal chrome and the profile header.
//
// Pure, and separate from the components that render it, because the same three
// strings (name, email, initials) are shown in four places: the top-bar user chip,
// the account dropdown header, the My Profile card, and the profile page header.
// A second copy of "what do we call someone with no last name" is how the chip and
// the card end up disagreeing about the same speaker.

import { speakerInitials } from '@/features/speakers/initials'
import type { Speaker } from '@/types/domain'

export type PortalUser = {
  name: string
  email: string
  initials: string
  /**
   * The speaker's own uploaded headshot, when they have one. The initials are the
   * fallback, not the design: a speaker who has uploaded a photo through the profile
   * page expects to see it wherever the portal shows them back to themselves.
   */
  avatarUrl?: string
}

/**
 * Two letters from the name, falling back to the email, then to `'?'`.
 *
 * The email fallback matters more than it looks: a speaker created by a CFP submit
 * that only captured an address has no name at all until they open the profile page,
 * and an empty avatar circle reads as a broken image rather than as missing data.
 *
 * Delegates rather than repeating the rule. The version here ended at
 * `email.charAt(0).toUpperCase()`, which is `''` for a row whose three name-ish columns are
 * all blank, and `mapSpeaker` defaults both names to `''` so that row is reachable: the
 * fallback this comment argues for produced the very blank circle it exists to prevent.
 * `@/features/speakers/initials` is now the one implementation, and its `'?'` is the answer.
 *
 * Kept as a positional wrapper because the portal's callers pass three strings; the shared
 * helper takes an object so a half-built draft can satisfy it too.
 */
export function initialsOf(firstName: string, lastName: string, email: string): string {
  return speakerInitials({ firstName, lastName, email })
}

/** The name, or the email when there is no name to show. Never an empty string. */
export function displayNameOf(speaker: Pick<Speaker, 'firstName' | 'lastName' | 'email'>): string {
  const name = `${speaker.firstName} ${speaker.lastName}`.trim()
  return name === '' ? speaker.email : name
}

export function portalUserOf(
  speaker: Pick<Speaker, 'firstName' | 'lastName' | 'email' | 'headshotUrl'>,
): PortalUser {
  return {
    name: displayNameOf(speaker),
    email: speaker.email,
    initials: initialsOf(speaker.firstName, speaker.lastName, speaker.email),
    avatarUrl: speaker.headshotUrl,
  }
}
