// Turning the citations an answer carries into rows the palette can open.
//
// Split out of ask.ts, which had reached the 300 line limit. This is the whole of one
// concern and none of another: ask.ts owns asking (the prompt, the limits, the staleness
// rules and the mock), and this file owns the mapping from a cited record id to a row.
//
// The rows are built through the SAME two href builders the search palette uses
// (`global-search.ts`), and that is load-bearing rather than tidy: an answer row and a
// search row for one record pointing at different places would be a difference nobody
// could account for.

import type { AskRef, AskRows } from '@/features/ai/ask'
import { GROUP_LIMIT, speakerHref, submissionHref } from '@/features/search/global-search'
import type { Speaker, SubmissionWithParticipants } from '@/types/domain'
import type { GlobalSearchItem } from '@/types/search'

// `AskRef` and `AskRows` stay in ask.ts, where the schema that validates them lives, and are
// imported here as TYPES ONLY. A type import is erased at compile time, so the two files
// depend on each other in the type graph and not at runtime: there is no import cycle to
// resolve and no initialization order to get wrong.

/** Exported for `ask-mock.ts`, which names the speakers it matched the same way a row does. */
export function speakerName(speaker: Speaker): string {
  return `${speaker.firstName} ${speaker.lastName}`.trim()
}

function submissionItem(eventId: string, row: SubmissionWithParticipants): GlobalSearchItem {
  return {
    id: row.id,
    label: row.title,
    description: row.code,
    href: submissionHref(eventId, row.code),
  }
}

/**
 * A cited person opens their CRM PROFILE, and takes no `eventId` because a profile is
 * addressed by record id and is scoped on arrival.
 *
 * It used to be the Abstracts list filtered to their name, so an answer row that named
 * somebody opened one of their talks instead of the person. Same mismatch the palette had.
 */
function speakerItem(row: Speaker): GlobalSearchItem {
  return { id: row.id, label: speakerName(row), description: row.email, href: speakerHref(row.id) }
}

/**
 * Turn citations into rows, dropping every one that cannot be accounted for.
 *
 * Two maps rather than one, keyed per kind, so a speaker id cited as a submission finds
 * nothing instead of finding the wrong table's row. The cited order is preserved because
 * it is the model's own ranking, and the cap is `GROUP_LIMIT` so the Answer group cannot
 * push the Submissions and Speakers groups off the bottom of the dialog. Dropped refs
 * cost nothing towards that cap: a run of invented ids must not push out the real rows
 * cited after them.
 */
export function resolveRefs(
  refs: readonly AskRef[],
  context: { eventId: string } & AskRows,
): readonly GlobalSearchItem[] {
  const submissions = new Map(context.submissions.map((row) => [row.id, row]))
  const speakers = new Map(context.speakers.map((row) => [row.id, row]))

  const seen = new Set<string>()
  const items: GlobalSearchItem[] = []

  for (const ref of refs) {
    if (items.length >= GROUP_LIMIT) break

    const key = `${ref.kind}:${ref.id}`
    if (seen.has(key)) continue

    const item = itemFor(ref, context.eventId, submissions, speakers)
    if (item === undefined) continue

    seen.add(key)
    items.push(item)
  }

  return items
}

/** The lookup, split out so the loop above reads as the policy rather than the plumbing. */
function itemFor(
  ref: AskRef,
  eventId: string,
  submissions: ReadonlyMap<string, SubmissionWithParticipants>,
  speakers: ReadonlyMap<string, Speaker>,
): GlobalSearchItem | undefined {
  if (ref.kind === 'submission') {
    const row = submissions.get(ref.id)
    return row === undefined ? undefined : submissionItem(eventId, row)
  }
  const row = speakers.get(ref.id)
  return row === undefined ? undefined : speakerItem(row)
}
