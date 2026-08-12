// Review-side column names: EvaluationPlans, Rounds, ReviewAssignments, Reviews, and the
// FileComments thread that hangs off the same screens.
//
// Split out of ./tables.ts when that file crossed the size limit, exactly as columns-cms.ts
// was. Nothing about how these are used changed: `COL` is still one flat object with one
// entry per concept, and this is spread into it. Import `COL` from ./tables, never this.

export const COL_REVIEW = {
  criteriaJson: 'criteriaJson',
  scoresJson: 'scoresJson',
  notesJson: 'notesJson',
  // Conflict of interest. One column, not two: the REASON goes in the review's own
  // `comment`, because a recusal reason is a comment about the submission and every
  // surface that shows a reviewer's comment already shows it with attribution. A second
  // column would be the same prose in a place only one screen knew to read.
  recused: 'recused',
  // File comments. `body` and not `comment`, because `comment` is already the reviewer's
  // note on a REVIEW and one registry cannot hold two meanings for one name.
  body: 'body',
  file: 'file',
  authorName: 'authorName',
  // Rounds. `reviewers` and not `reviewer`: the singular is the ONE reviewer a Review
  // or a ReviewAssignment belongs to, and this is a round's whole eligible pool. Two
  // columns of different arity sharing a name is how a link write silently replaces a
  // committee with one person.
  reviewers: 'reviewers',
  anonymous: 'anonymous',
  // The round's per-reviewer ceiling. `maxPerReviewer` and not `max`, because `max` is
  // already a criterion's scoring range in the rubric blob and this registry is flat.
  maxPerReviewer: 'maxPerReviewer',
  assignedAt: 'assignedAt',
  addedAt: 'addedAt',
  enteredAt: 'enteredAt',
  decidedAt: 'decidedAt',
  updatedAt: 'updatedAt',
} as const
