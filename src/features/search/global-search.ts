// The ⌘K palette's results: what is searched, where each hit goes, and what happens
// when there are more hits than fit.
//
// Pure, and separate from the action that feeds it, because every rule worth getting
// right here is a rule about strings and caps rather than about Airtable.
//
// **Substring matching, deliberately, and it has to stay substring.** cmdk runs its own
// fuzzy filter over each item's `value` on the client AFTER this function has picked the
// set, so a hit this module returns can still be dropped there. A substring match is also
// a subsequence match, which is what cmdk scores, so anything matched here survives that
// second pass as long as the field it matched on is inside the item's `value`. Switching
// this to a fuzzier rule would produce hits that vanish on arrival, which is a worse bug
// than not finding them: the palette would look like it was still broken.
//
// It matches what the Abstracts list already matches on (`SEARCHABLE_KEYS` in
// `abstracts-rows.ts`: code, title, track, tags, speakers, submitter) so that a query
// typed into the palette and the same query typed into the Abstracts search box do not
// disagree about what exists.

import type { Speaker, SubmissionWithParticipants } from '@/types/domain'
import type { GlobalSearchGroup, GlobalSearchItem } from '@/types/search'

/** Per group, before the overflow row. Eight is what fits without the dialog scrolling. */
export const GROUP_LIMIT = 8

/** Below this, a query is too broad to be a search: two characters matches most events. */
export const MIN_QUERY_LENGTH = 2

export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * What to say while a search is in flight or after one failed, or nothing when neither.
 *
 * Split from `searchEmptyMessage` because the two render in different places, and that
 * split is a bug fix rather than tidying. Both used to live in the dialog's `CommandEmpty`,
 * which cmdk renders only when its filtered count is zero: the `Go to` group almost always
 * matches something, so on the deployed Worker a cold search showed nav rows and no hint at
 * all for the ~2.5s the reads took, and a failed action would have been indistinguishable
 * from a search that found nothing. A status this module returns is rendered unconditionally.
 */
export function searchStatusMessage(input: {
  pending: boolean
  failure?: string
}): string | undefined {
  if (input.failure !== undefined) return input.failure
  return input.pending ? 'Searching...' : undefined
}

/**
 * What an empty result list says, which is only ever one of two true things: the query is
 * still too short to have been searched for, or a search ran and matched nothing.
 *
 * `No results found.` is the exact sentence the broken palette used to give to every
 * query, so it is the one sentence here that has to be earned.
 */
export function searchEmptyMessage(query: string): string {
  if (normalizeQuery(query).length < MIN_QUERY_LENGTH) {
    return `Keep typing to search submissions and speakers (${MIN_QUERY_LENGTH} characters).`
  }
  return 'No results found.'
}

function matches(needle: string, ...fields: readonly (string | undefined)[]): boolean {
  return fields.some((field) => field?.toLowerCase().includes(needle) === true)
}

function speakerName(speaker: Speaker): string {
  return `${speaker.firstName} ${speaker.lastName}`.trim()
}

// The two href builders below are exported rather than private because `resolveRefs` in
// `src/features/ai/ask.ts` turns a record the model cited into the same row this file
// builds for a search hit. An answer row and a search row for one submission pointing at
// different places would be a difference nobody could account for.

/**
 * Where a submission opens.
 *
 * The Abstracts list filtered to its own code, because there is no per-submission admin
 * route to send anyone to: the list IS the detail surface, with the status popover and the
 * row drawer on it. `code` is unique per event and is one of `SEARCHABLE_KEYS`, so the
 * destination lands on exactly one row rather than on a list the organizer has to re-scan.
 */
export function submissionHref(eventId: string, code: string): string {
  return `/admin/${eventId}/abstracts?q=${encodeURIComponent(code)}`
}

/**
 * Where a speaker opens: their CRM profile.
 *
 * THIS USED TO BE A LIE, and it is the bug this signature change fixes. It pointed at the
 * Abstracts list filtered to the person's name, on the reasoning that there was no speaker
 * detail route in the build and their work was the honest substitute. `/admin/crm/[speakerId]`
 * exists now, so that reasoning is stale, and what it left behind was a row filed under
 * `Speakers`, labelled with a person's name and their email address, that opened a
 * SUBMISSION. For a speaker with exactly one accepted talk the filtered list showed that
 * one talk, so the palette looked like it had opened the abstract instead of the person.
 * A row's label and its destination have to agree.
 *
 * It takes the record id rather than the name for the same reason: a name is not unique and
 * was never an identifier, it was a query string.
 */
export function speakerHref(speakerId: string): string {
  return `/admin/crm/${speakerId}`
}

function submissionItems(
  eventId: string,
  submissions: readonly SubmissionWithParticipants[],
  needle: string,
): readonly GlobalSearchItem[] {
  return submissions
    .filter((submission) =>
      matches(
        needle,
        submission.code,
        submission.title,
        ...submission.participants.map((participant) => speakerName(participant.speaker)),
      ),
    )
    .map((submission) => ({
      id: submission.id,
      label: submission.title,
      description: submission.code,
      href: submissionHref(eventId, submission.code),
      // The participants are carried because they are matched ON above and appear in
      // neither the title nor the code. Without this the client filter drops every talk
      // found by its speaker's name, which is precisely the case somebody searching a
      // person is asking about.
      keywords: submission.participants
        .map((participant) => speakerName(participant.speaker))
        .join(' '),
    }))
}

function speakerItems(
  eventId: string,
  speakers: readonly Speaker[],
  needle: string,
): readonly GlobalSearchItem[] {
  return speakers
    .filter((speaker) => matches(needle, speakerName(speaker), speaker.email, speaker.company))
    .map((speaker) => ({
      id: speaker.id,
      label: speakerName(speaker),
      description: speaker.email,
      href: speakerHref(speaker.id),
      // Company is matched on above and is shown nowhere, so it needs the same carry the
      // submission rows need. The email is already the description.
      keywords: speaker.company ?? '',
    }))
}

/**
 * Cap the group and say so when it was capped.
 *
 * The overflow row is the whole point of this function. A palette that shows 8 of 60
 * matches and looks identical to one showing all 8 matches is the silent-truncation
 * failure: the organizer concludes the other 52 rows do not exist. The row states the
 * real count and goes somewhere that can show all of them.
 */
function capped(
  items: readonly GlobalSearchItem[],
  overflow: (total: number) => GlobalSearchItem,
): readonly GlobalSearchItem[] {
  if (items.length <= GROUP_LIMIT) return items
  return [...items.slice(0, GROUP_LIMIT), overflow(items.length)]
}

export function globalSearchGroups(input: {
  eventId: string
  submissions: readonly SubmissionWithParticipants[]
  speakers: readonly Speaker[]
  query: string
}): readonly GlobalSearchGroup[] {
  const needle = normalizeQuery(input.query)
  if (needle.length < MIN_QUERY_LENGTH) return []

  const submissions = capped(
    submissionItems(input.eventId, input.submissions, needle),
    (total) => ({
      id: 'submissions-overflow',
      label: `See all ${total} matching submissions`,
      description: 'Abstracts',
      href: `/admin/${input.eventId}/abstracts?q=${encodeURIComponent(input.query.trim())}`,
    }),
  )

  const speakers = capped(speakerItems(input.eventId, input.speakers, needle), (total) => ({
    id: 'speakers-overflow',
    // Not "see all matching speakers": the task board is the event's whole roster and
    // cannot be filtered by a query, so promising a filtered list would be a lie.
    label: `${total} speakers match. Open the task board`,
    description: 'Tasks',
    href: `/admin/${input.eventId}/tasks`,
  }))

  return [
    ...(submissions.length === 0
      ? []
      : [{ id: 'submissions', label: 'Submissions', items: submissions }]),
    ...(speakers.length === 0 ? [] : [{ id: 'speakers', label: 'Speakers', items: speakers }]),
  ]
}
