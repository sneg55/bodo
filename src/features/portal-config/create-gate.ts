// What the create-portal wizard may do next, as data. The pure half of CreatePortalWizard.
//
// Split out under `features/` rather than beside the component for the two reasons this
// repo splits anything: `src/app/**` holds routes, and logic lives in `features/<area>`
// (.claude/rules/bodo-conventions.md); and this decides whether a half-built portal can be
// submitted, which is expensive to debug through a four-step dialog and cheap to assert
// here. ./create-gate.test.ts is the assertion.
//
// THE RULE IT REPLACES was one line and it was all-or-nothing:
//
//     const completed = new Set(name.trim() === '' ? [] : ['setup','filters','review','content'])
//
// Every step or no step, keyed only on the name. Typing a single character unlocked the
// whole rail, so Filters and Review could be skipped by clicking Content, and Continue was
// live on every step whatever was on it. A wizard that gates on nothing after step one is
// a wizard with four steps and one of them enforced.
//
// Two things are gated, and only two.
//
// The NAME, because `savePortalAction` refuses an empty one server-side, so without the gate
// the wizard's own last button posts a request it already knows will be turned down.
//
// A FILTER WITH NO VALUES, because it is the silent failure this whole feature has. `+ Add
// filter` inserts `Track is …` with an empty value list, and an empty rule matches NOBODY
// rather than everybody (features/portal-config/match.ts), so leaving the row untouched
// produces a portal that no contact ever lands on. Nothing about the row looks wrong: the
// field and the operator are filled in, and the portal saves and lists exactly like a
// working one. The only person who finds out is the speaker who never gets their tasks.
//
// AN EMPTY MATCH IS NOT GATED, and that is a different question deliberately answered the
// other way. A rule over session fields legitimately matches nobody before the call for
// papers closes, so blocking there would send an organizer away to widen a rule that was
// right. The review step warns instead, next to the button they are about to press.

import type { PortalFilterRule } from '@/types/portals'

/** The wizard's step ids, in rail order. Mirrors `STEPS` in CreatePortalWizard.tsx. */
export const CREATE_PORTAL_STEPS = ['setup', 'filters', 'review', 'content'] as const

export type CreatePortalGate = {
  /** Step ids whose own validation passes, for `WizardGate.completed`. */
  completed: ReadonlySet<string>
  /** Why Continue is dead, in the organizer's words. Empty when it is live. */
  blockers: readonly string[]
  /** Whether `+ Create Portal` may fire. The rail gates the same two things. */
  canSubmit: boolean
}

export function createPortalGate(input: {
  name: string
  rules: readonly PortalFilterRule[]
}): CreatePortalGate {
  const named = input.name.trim() !== ''
  // `every` over an empty list is true, which is the answer we want: no filters at all
  // means every contact of the chosen types lands here, and that is a valid portal.
  const valued = input.rules.every((rule) => rule.values.length > 0)

  return {
    completed: new Set([
      ...(named ? ['setup'] : []),
      ...(valued ? ['filters'] : []),
      // Review has no validation of its own; it is a place to look, not a form.
      'review',
      'content',
    ]),
    blockers: !named
      ? ['Give the portal a name.']
      : valued
        ? []
        : ['Every filter needs a value. A filter with none matches nobody.'],
    canSubmit: named && valued,
  }
}
