// The rules behind the evaluation plan editor: what a criterion may be, what a weight
// means once it is set, and what the editor refuses to save.
//
// Pure and total, and tested for the same reason `scoring.ts` is: a rubric is edited
// once a cycle and read on every review, so a rule that is wrong here is discovered
// after forty reviews have been filed against it.
//
// Three things this module exists to settle:
//
//   1. A weight is a RATIO, not a percentage. `scoring.ts` divides by the sum of the
//      weights that actually contributed, so 2 and 1 mean the same thing as 20 and 10.
//      Organizers read them as percentages anyway, so `weightShares` is what the editor
//      renders next to the number, and it is derived rather than stored: storing a
//      percentage would make it wrong the moment a criterion is added.
//   2. A `select` criterion's range is still derived from its options, never from the
//      min/max fields, so a dropdown's displayed range matches what its options say.
//      That range is no longer used for weighting (see 3), only kept as metadata.
//   3. A `select` criterion carries weight 0, the same as `text`, and always has: an
//      option's numeric `value` promises nothing about which end is favourable (see
//      `scoring.ts`'s `countedCriteria` for the full reasoning and the exact bug this
//      corrects), so it cannot be safely folded into the weighted mean. `newCriterion`
//      and `normalizeCriterion` both force it, and `weightShares` reports 0% for it,
//      so a `select` row always reads the same "not counted" way in the editor that a
//      `text` row does.

import type { Criterion, CriterionKind, CriterionOption } from '@/types/domain'

/** What the editor offers, in the order it offers them. */
export const CRITERION_KINDS: readonly CriterionKind[] = ['numeric', 'select', 'text']

const KIND_LABELS: ReadonlyMap<CriterionKind, string> = new Map([
  ['numeric', 'Rating'],
  ['select', 'Dropdown'],
  ['text', 'Free text'],
])

export function criterionKindLabel(kind: CriterionKind): string {
  return KIND_LABELS.get(kind) ?? kind
}

export function isCriterionKind(value: string): value is CriterionKind {
  return CRITERION_KINDS.some((kind) => kind === value)
}

/**
 * A stable key for a new criterion.
 *
 * Derived from the label but NEVER rewritten afterwards, which is the whole point: the
 * key is what a saved score is filed under, so renaming "Relevance" to "Topic fit"
 * must not orphan every score already recorded against it. The editor therefore
 * generates a key once, at creation, and the label is free to change forever after.
 *
 * A label with no usable characters (an emoji, a language this slug cannot represent)
 * falls back to a counter, because a criterion with an empty key would collide with
 * every other one.
 */
export function criterionKey(label: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base =
    label
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-+|-+$/g, '')
      .slice(0, 40) || 'criterion'

  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}-${String(n)}`)) n += 1
  return `${base}-${String(n)}`
}

/** A new criterion of the requested kind, with the defaults the editor starts from. */
export function newCriterion(kind: CriterionKind, key: string): Criterion {
  if (kind === 'select') {
    const options: readonly CriterionOption[] = [
      { label: 'Weak', value: 1 },
      { label: 'Fair', value: 2 },
      { label: 'Strong', value: 3 },
    ]
    // Weight 0, like `text` below: a dropdown's option values cannot be trusted to
    // run "worse to better" (see `scoring.ts`), so it never contributes to the
    // weighted mean and starting it at a nonzero weight would claim influence it
    // does not have.
    return { key, label: '', kind, min: 1, max: 3, weight: 0, options }
  }
  // A text criterion carries weight 0 because it can never contribute to the mean.
  // Storing 1 would make the editor's own weight column claim influence it does not
  // have, and `scoring.ts` would ignore it either way.
  if (kind === 'text') return { key, label: '', kind, min: 0, max: 0, weight: 0 }
  return { key, label: '', kind, min: 1, max: 5, weight: 1 }
}

/**
 * Force a criterion into a shape `scoring.ts` can read, whatever the editor produced.
 *
 * Applied on the way into the write rather than trusted from the form, for the reason
 * `sanitizeScores` gives about its own input: a Server Action is reachable by POST with
 * no page ever rendering, and a rubric that reached Airtable with `max` below `min`
 * would be a criterion that silently stops counting on every review from then on.
 */
export function normalizeCriterion(criterion: Criterion): Criterion {
  const label = criterion.label.trim()
  const weight = Number.isFinite(criterion.weight) ? Math.max(criterion.weight, 0) : 0

  if (criterion.kind === 'text') {
    return { key: criterion.key, label, kind: 'text', min: 0, max: 0, weight: 0 }
  }

  if (criterion.kind === 'select') {
    const options = (criterion.options ?? [])
      .map((option) => ({ label: option.label.trim(), value: option.value }))
      .filter((option) => option.label !== '' && Number.isFinite(option.value))
    const values = options.map((option) => option.value)
    // min/max derived, never taken from the form: see the note at the top of the file.
    // weight forced to 0 regardless of what the form held, for the same reason `text`
    // is forced below: an option's value cannot be trusted to run worse-to-better
    // (`scoring.ts`), so a `select` criterion never contributes to the weighted mean
    // and must not keep displaying a weight that implies it does.
    return {
      key: criterion.key,
      label,
      kind: 'select',
      min: values.length === 0 ? 0 : Math.min(...values),
      max: values.length === 0 ? 0 : Math.max(...values),
      weight: 0,
      options,
    }
  }

  const min = Number.isFinite(criterion.min) ? criterion.min : 0
  const max = Number.isFinite(criterion.max) ? criterion.max : 0
  return {
    key: criterion.key,
    label,
    kind: 'numeric',
    min: Math.min(min, max),
    max: Math.max(min, max),
    weight,
  }
}

export type CriterionProblem = { key: string; message: string }

/**
 * What the editor will not save, and why.
 *
 * Deliberately short. Everything that CAN be silently repaired is repaired by
 * `normalizeCriterion` instead, because an editor that refuses a save over a reversed
 * min/max is one an organizer works around by giving up. These four are the ones where
 * repairing would mean guessing at what the organizer meant.
 */
export function criterionProblems(criteria: readonly Criterion[]): readonly CriterionProblem[] {
  const problems: CriterionProblem[] = []
  const seen = new Set<string>()

  for (const criterion of criteria) {
    if (criterion.label.trim() === '') {
      problems.push({ key: criterion.key, message: 'needs a label' })
    }
    if (seen.has(criterion.key)) {
      problems.push({ key: criterion.key, message: 'is listed twice' })
    }
    seen.add(criterion.key)

    if (criterion.kind === 'select' && (criterion.options ?? []).length < 2) {
      problems.push({ key: criterion.key, message: 'needs at least two options' })
    }
    if (criterion.kind === 'numeric' && criterion.max === criterion.min) {
      problems.push({
        key: criterion.key,
        // Not repaired, because widening the range for them would invent a scale.
        message: 'has a range of zero, so every score would be identical',
      })
    }
  }

  return problems
}

/**
 * Each criterion's share of the total influence, as a fraction of 1.
 *
 * This is what `scoring.ts` actually does with the weights, spelled out so the editor
 * can show it: an organizer typing 3 next to 1 is setting 75% and 25%, and until this
 * number was on screen there was no way to tell that from the two numbers alone.
 *
 * Criteria that cannot contribute (text, select, zero weight, zero range) are 0
 * rather than absent, so the editor can render a share for every row.
 *
 * `kind === 'numeric'` rather than `kind !== 'text'`, on purpose: a `select`
 * criterion's `weight` is forced to 0 by `newCriterion`/`normalizeCriterion` (see
 * `scoring.ts`'s `countedCriteria`), but a round saved before that rule existed can
 * still hold a nonzero weight on a `select` row until it is next saved, and this
 * function has to show 0% for it right now, not only after a resave.
 */
export function weightShares(criteria: readonly Criterion[]): ReadonlyMap<string, number> {
  const counting = criteria.filter(
    (criterion) =>
      criterion.kind === 'numeric' && criterion.weight > 0 && criterion.max > criterion.min,
  )
  const total = counting.reduce((sum, criterion) => sum + criterion.weight, 0)

  const shares = new Map<string, number>()
  for (const criterion of criteria) {
    const counts = counting.includes(criterion)
    shares.set(criterion.key, counts && total > 0 ? criterion.weight / total : 0)
  }
  return shares
}

/** Move a criterion one place up or down. Out-of-range moves are no-ops. */
export function moveCriterion(
  criteria: readonly Criterion[],
  index: number,
  delta: number,
): readonly Criterion[] {
  const target = index + delta
  if (index < 0 || index >= criteria.length || target < 0 || target >= criteria.length) {
    return criteria
  }
  const next = [...criteria]
  const moved = next.splice(index, 1)
  const item = moved.at(0)
  if (item === undefined) return criteria
  next.splice(target, 0, item)
  return next
}
