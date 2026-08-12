// Which track a submission is filed under.
//
// Its own module because there are two writers now: `prepareSubmission` for a real
// submit and `prepareDraft` for a save-and-finish-later, and this is precisely the rule
// that must not exist twice. It was wrong once already and cost two rubric items.

import { matchedTrackId } from '@/features/forms/logic'
import type { SubmissionColumnValues } from '@/features/submissions/columns'
import type { RecordId } from '@/types/domain'
import type { Form, FormField } from '@/types/forms'

export type TrackPrecedenceInput = {
  routing: Form['routing']
  fields: readonly FormField[]
  /** The SANITIZED answers. Routing off a hidden answer files a track nobody chose. */
  answers: Record<string, unknown>
  columns: SubmissionColumnValues
}

/**
 * Precedence, in order, and all three cases are load-bearing:
 *
 *   1. the organizer PUT a Track question on the form and the speaker answered it, so
 *      that answer is the track: it is a statement about this column, not an input a
 *      rule infers one from;
 *   2. they were not asked, or left it blank, and a routing rule matched, so the
 *      organizer's rule assigns it;
 *   3. neither, so the form's default track catches it.
 *
 * Cases 2 and 3 are why routing exists and nothing here weakens them: the seeded CFP
 * form asks no Track question at all, so a rule still decides every submission through
 * it, which is R1's acceptance criterion.
 *
 * The ORDER of 1 and 2 is the fix for the CFP-06 and CFP-15 evaluation findings. It read
 * `matchedTrackId(...) ?? columns.trackId ?? default`, and the seeded form carries a rule
 * `format eq talk -> Agents`. A speaker who picked `Talk (30 min)` AND chose the track
 * `Platform & Infra` therefore had the rule silently overrule them: the wizard's own
 * "Submitted answers" block showed `Platform & Infra` while the Abstracts list, the
 * detail header, the reviewer queue and, after acceptance, the session and agenda rows
 * all read `Agents`. An organizer cannot both ask the speaker to choose and then discard
 * the choice; a form that asks is a form whose answer wins.
 *
 * An earlier bug in the same expression is worth not re-introducing: this once read
 * `routeToTrack(...) ?? columns.trackId`, where `routeToTrack` returned the default
 * rather than `undefined` when no rule matched, so the `??` was dead and the speaker's
 * answer was unreachable from either side.
 */
export function resolveTrackId(input: TrackPrecedenceInput): RecordId | undefined {
  return (
    input.columns.trackId ??
    matchedTrackId(input.routing, input.fields, input.answers) ??
    input.routing.defaultTrackId
  )
}

export type TrackReconciliationInput = TrackPrecedenceInput & {
  /** What the record currently holds. */
  storedTrackId?: RecordId
}

/**
 * Whether an EXISTING submission's stored track disagrees with what its own answers
 * resolve to today, and if so, what it should be corrected to.
 *
 * The precedence fix above only ever runs forward: a record written while
 * `matchedTrackId(...) ?? columns.trackId` was still the order keeps that wrong track
 * until something rewrites it, because accepting a submission is a status flip
 * (`commitStatus`) and never re-derives the track. This is that rewrite, called out on
 * its own rather than folded into `resolveTrackId`, because it answers a different
 * question: not "which track does this submission belong to" but "does the stored value
 * still deserve to be there."
 *
 * Only ever returns a value when case 1 applies: the submission's own answers name a
 * track directly, by an id `columns.trackId` already resolved against this event's
 * categories. An explicit answer is a statement about the record, not an input a rule
 * infers one from, so a stored value that contradicts it can only be explained by the
 * write bug that used to let routing outrank it.
 *
 * Deliberately silent whenever `columns.trackId` is `undefined`, i.e. cases 2 and 3.
 * Recomputing routing or the default against TODAY's form would let a routing rule an
 * organizer edited after the fact silently reassign a record that was decided under the
 * rule as it stood then, and it would erase an organizer's own manual reassignment made
 * through some other route with nothing behind it but "no answer, so route again." Both
 * are real decisions this function cannot tell apart from staleness, so it leaves them
 * alone. Only an unambiguous, still-present speaker answer is corrected, and only
 * because that answer was always supposed to win.
 */
export function staleTrackId(input: TrackReconciliationInput): RecordId | undefined {
  const answered = input.columns.trackId
  if (answered === undefined) return undefined
  return answered === input.storedTrackId ? undefined : answered
}
