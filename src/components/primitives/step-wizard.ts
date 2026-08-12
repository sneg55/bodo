// Step navigation for a linear wizard, as data. The pure half of the StepWizard primitive.
//
// Separate from the component for the reason every other pure module in this codebase is
// separate: the arithmetic here decides whether an organizer can leave a step, and getting
// it wrong either traps them on a valid step or lets them submit a half-built portal. That
// is expensive to debug through the UI and cheap to test directly.
//
// BUILD_SPEC names StepWizard as one of the five shared primitives. It did not exist when
// the form builder needed a rail, so `forms/[formId]/EditorRail.tsx` grew one, and the
// portal create flow and the import flow would have been the second and third. This file
// plus StepWizard.tsx is that rail generalized; EditorRail now delegates its rendering
// here rather than being forked again.
//
// The one structural difference between the two callers, and it is why `completed` is a
// parameter rather than an assumption: the form editor edits a record that ALREADY EXISTS,
// so every step is reachable and an organizer fixing the close date should not walk five
// steps to get there. A create wizard does not, so it gates. One primitive serves both by
// being told which it is, rather than by guessing from its props.

/** One step. `id` is a stable string, never an array position: steps are filtered. */
export type WizardStep = {
  id: string
  title: string
  subtitle?: string
}

export type WizardMode =
  /** Editing something that exists. Every step is reachable, in any order. */
  | 'free'
  /** Creating something. A step is reachable once every step before it is complete. */
  | 'gated'

/**
 * The mode and the per-step validity, together.
 *
 * One object rather than two parameters because they are never meaningfully passed apart:
 * `completed` is unread in `free` mode, and `mode` decides nothing without it.
 */
export type WizardGate = {
  mode: WizardMode
  /** Step ids whose own validation currently passes. Recomputed on every render. */
  completed: ReadonlySet<string>
}

/** Where `id` sits, or -1. Exported because "not in this list" is a real answer. */
export function stepPosition(steps: readonly WizardStep[], id: string): number {
  return steps.findIndex((step) => step.id === id)
}

/**
 * The step `delta` away, clamped at both ends.
 *
 * Clamped rather than wrapped, and rather than returning undefined at the edges: Back on
 * the first step and Continue on the last are states the FOOTER disables, so a caller that
 * reaches here has already lost that argument and the least surprising answer is to stay
 * put. An unknown `current` returns itself for the same reason.
 */
export function neighbourStep(
  steps: readonly WizardStep[],
  current: string,
  delta: number,
): string {
  const at = stepPosition(steps, current)
  if (at === -1) return current
  const target = Math.max(0, Math.min(steps.length - 1, at + delta))
  return steps.at(target)?.id ?? current
}

/**
 * Whether the organizer may jump to `target` from `current`.
 *
 * In `gated` mode this is the whole safety rule, and it is deliberately NOT "every step
 * before target is complete". It is stricter: the first INCOMPLETE step is the furthest
 * anyone may reach. The difference shows up on a wizard whose step 2 was completed, then
 * step 1 was edited back into an invalid state: the looser rule would still let them reach
 * step 3 on the strength of a step 2 that is now describing a portal that no longer exists.
 *
 * Going BACKWARDS is always allowed in both modes. A wizard that will not let somebody
 * re-read what they typed is a wizard they abandon.
 */
export function canReachStep(
  steps: readonly WizardStep[],
  current: string,
  target: string,
  gate: WizardGate,
): boolean {
  const from = stepPosition(steps, current)
  const to = stepPosition(steps, target)
  if (to === -1 || from === -1) return false
  if (gate.mode === 'free') return true
  if (to <= from) return true
  return steps.slice(0, to).every((step) => gate.completed.has(step.id))
}

/**
 * The steps to draw with a checkmark.
 *
 * Position-based rather than `completed`-based, because the two answer different
 * questions: `completed` is "is this step valid", which the footer uses, and this is "has
 * the organizer been here", which is what the rail's three states transcribe. A step
 * behind the current one that has been emptied out should still read as visited, or the
 * rail appears to lose progress while they are standing on the next step.
 */
export function visitedSteps(steps: readonly WizardStep[], current: string): readonly string[] {
  const at = stepPosition(steps, current)
  if (at <= 0) return []
  return steps.slice(0, at).map((step) => step.id)
}

/** Steps the rail draws greyed and unclickable. Empty in `free` mode by construction. */
export function lockedSteps(
  steps: readonly WizardStep[],
  current: string,
  gate: WizardGate,
): readonly string[] {
  if (gate.mode === 'free') return []
  return steps.filter((step) => !canReachStep(steps, current, step.id, gate)).map((step) => step.id)
}

/**
 * Whether Continue is live: there is a step after this one, and it is reachable.
 *
 * Asks `canReachStep` about the NEXT step rather than testing `completed.has(current)`
 * itself, and the difference is not academic. The two rules disagree whenever an EARLIER
 * step has been edited back into an invalid state: with the current step complete and the
 * one before it broken, the rail correctly greys the next step while a self-contained
 * `canAdvance` would leave Continue live, so the button walked past a gate the rail was
 * still drawing shut. One rule, asked twice, cannot drift like that.
 */
export function canAdvance(
  steps: readonly WizardStep[],
  current: string,
  gate: WizardGate,
): boolean {
  const at = stepPosition(steps, current)
  if (at === -1 || at >= steps.length - 1) return false
  const next = steps.at(at + 1)
  return next !== undefined && canReachStep(steps, current, next.id, gate)
}

/** Whether this is the last step, which is where the wizard's own action replaces Continue. */
export function isFinalStep(steps: readonly WizardStep[], current: string): boolean {
  return steps.length > 0 && stepPosition(steps, current) === steps.length - 1
}
