// Per-reviewer completion, for one round or across the plan.
//
// Round-level progress already existed and was accurate; it aggregated the whole
// committee together, so "6 of 12 reviews in" could equally be one reviewer who has done
// everything and one who has not started, or two who are each half done. Those need
// different actions from an organizer, which is the point of splitting it out.
//
// Pure and total, and tested, for the reason `scoring.ts` gives about itself: this feeds
// a chase-up decision, and a count that is quietly wrong sends a reminder to the wrong
// person.
//
// EVERY reviewer in the pool appears, including one with nothing assigned. A reviewer at
// 0 of 0 is the specific thing an organizer needs to see, because it means the assignment
// step was missed rather than that the reviewer is slow, and a list that only showed
// people with work would hide exactly that case.

import type { RecordId } from '@/types/domain'

export type ReviewerProgressRow = {
  readonly reviewerId: RecordId
  /** Never blank. See `reviewerDisplayName`. */
  readonly name: string
  readonly email: string
  readonly assigned: number
  /** Reviews filed, recusals included: both are the reviewer having dealt with the row. */
  readonly reviewed: number
  /** Of those, how many were a declared conflict of interest rather than a score. */
  readonly recused: number
  /** 0-100, rounded. Zero when nothing is assigned, which `assigned` disambiguates. */
  readonly percent: number
  /** Assigned, neither scored nor recused. What a reminder would be about. */
  readonly outstanding: number
}

type Assignment = { readonly roundId: string; submissionId: string; reviewerId: string }
type ReviewKey = {
  readonly roundId: string
  submissionId: string
  reviewerId: string
  readonly recused?: boolean
}

/** `submissionId:roundId:reviewerId`, the tuple Reviews is unique on. */
function key(row: ReviewKey): string {
  return `${row.submissionId}:${row.roundId}:${row.reviewerId}`
}

/**
 * What to call a reviewer. Never the empty string.
 *
 * An AdminUsers row carries a name only once somebody has filled it in, so a member added
 * by email and not yet signed in has none, and every evaluation surface rendered that as a
 * blank row: `"", 2 of 3` in the progress list, an unlabelled checkbox in the reviewer
 * pool. Blank reads as a broken row rather than as missing data, and there is nothing to
 * click on.
 *
 * The email is the fallback, matching `reviewerNames` in submission-detail.ts and the
 * committee picker, because it is the thing the organizer typed and therefore the thing
 * they recognise. `No name yet` is the last resort and is TeamTable's own wording: it is
 * reachable only for a membership whose AdminUsers row was deleted, which the reviewer
 * reads drop, so it exists to keep this total rather than because it is expected.
 */
export function reviewerDisplayName(reviewer: { name: string; email: string }): string {
  if (reviewer.name.trim() !== '') return reviewer.name
  return reviewer.email.trim() === '' ? 'No name yet' : reviewer.email
}

export function reviewerProgress(input: {
  reviewers: readonly { id: RecordId; name: string; email: string }[]
  assignments: readonly Assignment[]
  reviews: readonly ReviewKey[]
  /** Scope to one round. Omit to count across every round in the data given. */
  roundId?: RecordId
}): readonly ReviewerProgressRow[] {
  const inScope =
    input.roundId === undefined
      ? input.assignments
      : input.assignments.filter((row) => row.roundId === input.roundId)
  // A RECUSED review counts as handled. The reviewer has answered: they should not be
  // the one deciding it. Chasing them for a score they have already declined to give is
  // the single most annoying thing a reminder can do, so `outstanding` excludes it and
  // `recused` reports it separately, because the chair still has a row to reassign.
  const done = new Set(input.reviews.map(key))
  const recusedKeys = new Set(input.reviews.filter((row) => row.recused === true).map(key))

  const rows = input.reviewers.map((reviewer) => {
    // DISTINCT (submission, round, reviewer), not assignment ROWS, and the same rule the
    // round tab counts by (evaluation-queue.ts): a reviewer holds one review per tuple, so
    // a tuple assigned twice is one piece of work. Counted as two, this reviewer could
    // never reach 100% and the two counters would disagree about the same round.
    const mine = [...new Set(inScope.filter((row) => row.reviewerId === reviewer.id).map(key))]
    const reviewed = mine.filter((row) => done.has(row)).length
    return {
      reviewerId: reviewer.id,
      name: reviewerDisplayName(reviewer),
      email: reviewer.email,
      assigned: mine.length,
      reviewed,
      recused: mine.filter((row) => recusedKeys.has(row)).length,
      // Zero rather than 100 when nothing is assigned. "Finished" is a claim about work
      // that existed, and showing a reviewer with no queue at 100% is how the person who
      // was never assigned anything gets read as the one who is done.
      percent: mine.length === 0 ? 0 : Math.round((reviewed / mine.length) * 100),
      outstanding: mine.length - reviewed,
    }
  })

  // Furthest behind first, because the list exists to answer "who do I chase". Ties break
  // on name so the order is stable between reads rather than following the reviewer list.
  return rows.sort(
    (left, right) => right.outstanding - left.outstanding || left.name.localeCompare(right.name),
  )
}

/** The reviewers a bulk reminder would go to: assigned work, not finished. */
export function reviewersBehind(
  rows: readonly ReviewerProgressRow[],
): readonly ReviewerProgressRow[] {
  return rows.filter((row) => row.outstanding > 0)
}
