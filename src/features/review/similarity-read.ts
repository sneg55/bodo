// The similarity sweep for ONE submission, assembled from records a caller has already read.
//
// It exists because the two halves of the sweep live in different places and neither of them
// should learn about the other. `similarity.ts` compares `SimilarityRow`s and knows nothing
// about forms or Airtable; `loadSubmissionDetail` reads the event's records and knows nothing
// about trigrams. The join between them is three decisions that are easy to get quietly wrong,
// so they are made once, here, and unit tested (`tests/similarity-wiring.test.ts`) without a
// base:
//
//   - The body is a form ANSWER keyed by the id of the field carrying the `description`
//     registry key, so the rows cannot be built without the event's forms. Skipping that
//     resolution does not fail, it compares titles against empty strings, which is the failure
//     mode that reports nothing and looks like a clean round.
//   - The target is in the list, and stays in it. `listSubmissions(eventId)` returns every
//     submission on the event including the one being viewed, and `similarTo` already removes
//     it by ID (not by score: a record is trivially 100% similar to itself). Filtering it out
//     here too would be a second definition of "the same submission" to keep in step with that
//     one, and the id it is matched on is the only thing making a self-match impossible.
//   - Order decides what the cap keeps. `similarTo` compares the first `maxRows` rows and
//     names the rest, so the input order is the policy for which rows a large event actually
//     checks. See `byNewestFirst`.
//
// Pure and total, like the module it wraps: no I/O, no clock, no throwing. It takes rows the
// caller loaded through the tagged DAL reads, so it adds no read path and no cache tag.

import { descriptionFieldIds } from '@/features/review/abstract-text'
import {
  type SimilarityOptions,
  type SimilarToResult,
  similarityRow,
  similarTo,
} from '@/features/review/similarity'
import type { SubmissionWithParticipants } from '@/types/domain'
import type { Form } from '@/types/forms'

/**
 * Newest submitted first, with a code tiebreak so the order is total and a render cannot
 * reshuffle equal rows.
 *
 * Newest first because the cases the feature is for arrive late: a speaker who submitted twice
 * and a resubmission of an abstract from an earlier round are both near the end of the list,
 * and a cap that kept the first 400 in Airtable's own order would compare the openings of the
 * CFP against each other and drop exactly the rows worth checking. A record with no
 * `submittedAt` (created by hand in the organizer UI, never posted through a form) sorts last
 * for the same reason rather than because it matters less.
 */
function byNewestFirst(
  left: SubmissionWithParticipants,
  right: SubmissionWithParticipants,
): number {
  const leftAt = left.submittedAt ?? ''
  const rightAt = right.submittedAt ?? ''
  if (leftAt !== rightAt) return rightAt.localeCompare(leftAt)
  return left.code.localeCompare(right.code)
}

/**
 * The near-duplicates of `target` among `submissions`, scored against title and abstract body.
 *
 * `submissions` is the event's whole list, target included; `forms` is the event's forms, used
 * only to find where each record keeps its abstract. Both are already loaded by whoever calls
 * this, which is what keeps the neighbour panel from costing a read of its own.
 */
export function similarToSubmission(input: {
  target: SubmissionWithParticipants
  submissions: readonly SubmissionWithParticipants[]
  forms: readonly Form[]
  options?: SimilarityOptions
}): SimilarToResult {
  const fieldIdByForm = descriptionFieldIds(input.forms)
  const rows = [...input.submissions]
    .sort(byNewestFirst)
    .map((submission) => similarityRow(submission, fieldIdByForm))

  return similarTo(similarityRow(input.target, fieldIdByForm), rows, input.options)
}
