// How one stored answer reads back as something a person recognises.
//
// A `select` criterion stores the NUMBER its chosen option carries and never the option's
// text. That is deliberate and `CriterionControl` explains why: it lets `scoring.ts`
// normalise a dropdown over its own range exactly like a slider, with no per-kind branch.
// What was missing was the reader for the other direction. The label sits on the criterion
// the whole time, so a rubric whose "Recommendation" dropdown offers Accept / Maybe /
// Reject read back as a bare `1` in two places at once: the reviewer's Select trigger, and
// the organizer's Reviews block, which printed `1/3` under the criterion's own name.
//
// Both surfaces resolve through this module rather than each doing their own lookup, so a
// dropdown cannot read one way to the reviewer who answered it and another way to the chair
// who decides on it.
//
// Pure and total. It runs inside a cached read (`submission-detail.ts`), so a criterion in
// any shape Airtable can hold has to return a string rather than throw.

import type { Criterion } from '@/types/domain'

/**
 * The chosen option's text, or `undefined` when no option in the rubric carries that score.
 *
 * `undefined` rather than a guess: an organizer who renumbered a dropdown's options after
 * reviews landed leaves scores that match nothing, and inventing a label for one would
 * misreport a verdict. The caller falls back to the raw number, which is at least true.
 */
export function criterionOptionLabel(criterion: Criterion, score: number): string | undefined {
  if (criterion.kind !== 'select') return undefined
  const match = (criterion.options ?? []).find((option) => option.value === score)
  return match === undefined || match.label === '' ? undefined : match.label
}

/**
 * The value-to-label map Base UI's `Select` reads to render its CLOSED trigger.
 *
 * Keyed by the string form of the score because that is what the control is controlled by:
 * `Select.Value` looks the current value up in this record verbatim
 * (`internals/resolveValueLabel.js`), so a numeric key would never match and the trigger
 * would fall back to printing the value itself.
 */
export function criterionSelectItems(criterion: Criterion): Record<string, string> {
  return Object.fromEntries(
    (criterion.options ?? []).map((option) => [String(option.value), option.label]),
  )
}

/**
 * One stored score as the organizer's Reviews block prints it.
 *
 * A dropdown reads as its label, because "Accept" is the answer the reviewer gave and
 * `1/3` is only how it is stored. A slider keeps `value/max`, because there the number IS
 * the answer and the ceiling is what makes it mean anything.
 */
export function criterionScoreText(criterion: Criterion, score: number): string {
  const label = criterionOptionLabel(criterion, score)
  if (label !== undefined) return label
  // A select with no matching option still prints its bare number rather than a range: its
  // min/max are derived from the options (`plan-editor.ts`), so `1/3` would describe a
  // scale the reviewer was never shown.
  if (criterion.kind === 'select') return String(score)
  return `${String(score)}/${String(criterion.max)}`
}
