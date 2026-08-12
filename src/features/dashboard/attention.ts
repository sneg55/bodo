// The event home's actionable banners, ref 36.
//
// A sibling of home-view.ts rather than more of it, because that file is already at the
// size the file-size hook stops at, and these are a separate fact: the "Also check" strip
// is a one-line list of things to glance at, while a banner is a sentence with a count and
// the button that acts on it.
//
// Ref 36 is also where the strip and the banners overlap: on the Participants sub-tab the
// awaiting-decision item leaves the strip and reappears as a banner with "Review
// submissions". bodo has no sub-tabs (three of the four panels behind them are charts), so
// both would land on one screen and state the same count twice. `stripEntries()` is that
// rule made explicit: a banner declares the strip item it supersedes, and the strip drops
// it. Tested in tests/dashboard-attention.test.ts.
//
// Pure for the same reason the rest of the home is: every number here is an off-by-one an
// organizer would act on. Counting a speaker once per accepted talk would turn two people
// with three talks each into "6 accepted speakers are missing a bio".

import type { Advisory } from '@/features/dashboard/home-view'
import type { SubmissionWithParticipants } from '@/types/domain'

export type AttentionBanner = {
  id: string
  text: string
  /** The link at the banner's right. Ref 36: "Review submissions", "View speakers". */
  actionLabel: string
  href: string
  /** The `Advisory.id` this banner already states, so the strip can drop it. */
  coversAdvisoryId?: string
}

/** Distinct accepted PEOPLE with an incomplete profile, and the gaps themselves. */
export type ProfileGaps = {
  /** People missing a bio, a headshot, or both. The banner's subject. */
  people: number
  bios: number
  headshots: number
}

type ParticipantOf = { speaker: { id: string; bio?: string; headshotUrl?: string } }
type SubmissionOf = Pick<SubmissionWithParticipants, 'status'> & {
  participants: readonly ParticipantOf[]
}

/**
 * Counted over a Set of speaker ids, which is the whole point of this function: a speaker
 * with three accepted talks is one accepted speaker, exactly as the KPI tile counts them.
 *
 * Every participant counts, not only the primary, for the reason the KPI tile gives: a
 * co-presenter with no headshot is a hole in the same programme page.
 */
export function profileGaps(submissions: readonly SubmissionOf[]): ProfileGaps {
  const seen = new Map<string, { bio: boolean; headshot: boolean }>()
  for (const submission of submissions) {
    if (submission.status !== 'accepted') continue
    for (const participant of submission.participants) {
      const { speaker } = participant
      seen.set(speaker.id, {
        bio: blank(speaker.bio),
        headshot: blank(speaker.headshotUrl),
      })
    }
  }

  const gaps = [...seen.values()]
  return {
    people: gaps.filter((gap) => gap.bio || gap.headshot).length,
    bios: gaps.filter((gap) => gap.bio).length,
    headshots: gaps.filter((gap) => gap.headshot).length,
  }
}

/**
 * The banners, in ref 36's order, and only the ones that fired.
 *
 * A banner with a zero count is not rendered at all rather than reading "0 submissions are
 * awaiting a decision": a dashboard that lists its own non-problems teaches an organizer to
 * ignore the row where a real one will appear.
 */
export function attentionBanners(input: {
  submissions: readonly SubmissionOf[]
  eventHref: (path: string) => string
}): readonly AttentionBanner[] {
  const { submissions, eventHref } = input
  const found: AttentionBanner[] = []

  const awaiting = submissions.filter((row) => row.status === 'pending').length
  if (awaiting > 0) {
    found.push({
      id: 'awaiting',
      // Verbatim ref 36, and the same sentence the strip's item carries, which is why this
      // banner supersedes it instead of sitting above it.
      text: `${awaiting} session ${plural(awaiting, 'submission')} ${plural(awaiting, 'is', 'are')} awaiting a decision.`,
      actionLabel: 'Review submissions',
      // Straight to the pending tab of Abstracts, because "Review submissions" that lands
      // on all of them has made the organizer do the filtering the banner just did.
      href: eventHref('/abstracts?tab=pending'),
      coversAdvisoryId: 'awaiting',
    })
  }

  const gaps = profileGaps(submissions)
  if (gaps.people > 0) {
    found.push({
      id: 'profiles',
      text: `${gaps.people} accepted ${plural(gaps.people, 'speaker')} ${plural(gaps.people, 'is', 'are')} missing a bio or headshot (${gapParts(gaps)}).`,
      actionLabel: 'View speakers',
      // bodo has no participants list: the parity report waives one, and the only surface
      // that lists PEOPLE rather than submissions is the accepted-speaker roster on Tasks,
      // which is also where an organizer chases a missing headshot. So the label is the
      // captured one and the destination is the real surface behind it.
      href: eventHref('/tasks'),
    })
  }

  return found
}

/** The "Also check" items left once the banners have taken the ones they state. */
export function stripEntries(
  entries: readonly Advisory[],
  banners: readonly AttentionBanner[],
): readonly Advisory[] {
  const covered = new Set(
    banners.flatMap((banner) =>
      banner.coversAdvisoryId === undefined ? [] : [banner.coversAdvisoryId],
    ),
  )
  return entries.filter((entry) => !covered.has(entry.id))
}

/** `2 bios, 2 headshots`, with a zero side omitted rather than printed as "0 bios". */
function gapParts(gaps: ProfileGaps): string {
  const parts: string[] = []
  if (gaps.bios > 0) parts.push(`${gaps.bios} ${plural(gaps.bios, 'bio')}`)
  if (gaps.headshots > 0) parts.push(`${gaps.headshots} ${plural(gaps.headshots, 'headshot')}`)
  return parts.join(', ')
}

/** Airtable stores a cleared long-text field as text, so a space is still no bio. */
function blank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0
}

function plural(count: number, one: string, many?: string): string {
  if (count === 1) return one
  return many ?? `${one}s`
}
