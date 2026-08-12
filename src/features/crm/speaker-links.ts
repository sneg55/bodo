// A speaker's own links, turned into hrefs a browser will actually follow.
//
// Its own module rather than a helper inside `SpeakerProfile.tsx`, because it is a rule and
// a rule belongs where it can be asserted without a browser (`tests/crm-speaker-links.test.ts`).
// Not in `speaker-rows.ts` either: that is the directory's row model and no table column
// renders a link.

import type { Speaker } from '@/types/domain'

/** The labels the profile shows, verbatim from the portal's own profile form (ref 18). */
export const SPEAKER_LINK_LABELS = {
  linkedin: 'LinkedIn URL',
  x: 'X (Twitter) URL',
  facebook: 'Facebook URL',
  website: 'Website',
} as const

export type SpeakerProfileLink = {
  readonly label: string
  /** What the speaker stored, which is what is shown. */
  readonly text: string
  /** Where it goes, or absent when nothing safe can be made of it. */
  readonly href?: string
}

/**
 * A stored link, turned into an href, or `undefined` when there is nothing usable.
 *
 * `speakerLinksSchema` is four bare `z.string().optional()` and the portal write only
 * trims, so what a speaker types is what is stored, and what a speaker types is
 * `linkedin.com/in/ada`. That is a RELATIVE path in an `href`, so the profile's LinkedIn
 * link navigated to `/admin/crm/{speakerId}/linkedin.com/in/ada`. Not a security hole
 * (React 19 neutralizes a `javascript:` href), just a link that does not work on the input
 * people actually give.
 *
 * A scheme is added only when there is none. A stored `http://` is left alone rather than
 * upgraded: it is the speaker's own record of where their site is, and rewriting it would
 * break a host that does not serve TLS. Anything that parses to a scheme other than http or
 * https is refused, which covers `mailto:`, `data:` and everything else nobody typed into a
 * Website field on purpose; the caller renders the stored text with no link at all, because
 * showing a dead link is worse than showing a string.
 */
export function speakerLinkHref(url: string): string | undefined {
  const trimmed = url.trim()
  if (trimmed.length === 0) return undefined

  // A bare `example.com/x` has no scheme; `linkedin.com:8080/x` would parse as one, which
  // is why the test is a scheme followed by `//` or by something that is not all digits.
  const hasScheme = /^[a-z][a-z0-9+.-]*:(?!\d)/iu.test(trimmed)
  let parsed: URL
  try {
    parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
  } catch {
    return undefined
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined
}

/**
 * The four link rows the profile renders, in the portal form's own order, dropping the ones
 * the speaker left empty.
 *
 * A row whose value cannot be made into an href is KEPT, without one. The organizer is
 * looking at somebody else's data and "there is a website field and it says this" is
 * information; silently dropping it would make the card claim the speaker filled in nothing.
 */
export function speakerProfileLinks(speaker: Speaker): readonly SpeakerProfileLink[] {
  return (
    [
      [SPEAKER_LINK_LABELS.linkedin, speaker.links.linkedin],
      [SPEAKER_LINK_LABELS.x, speaker.links.x],
      [SPEAKER_LINK_LABELS.facebook, speaker.links.facebook],
      [SPEAKER_LINK_LABELS.website, speaker.links.website],
    ] as const
  ).flatMap(([label, url]) => {
    const text = url?.trim() ?? ''
    return text.length === 0 ? [] : [{ label, text, href: speakerLinkHref(text) }]
  })
}
