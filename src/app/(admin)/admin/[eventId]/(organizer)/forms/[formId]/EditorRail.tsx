'use client'

// The wizard step rail under "FORM SETUP" (parity ref 06).
//
// This used to draw the rail itself. It now adapts the form editor's numbered steps onto
// the shared `StepWizardRail`, because the portal create flow and the import flow both
// needed the same three states and BUILD_SPEC names StepWizard as one of the five
// primitives built once and reused. Nothing about the rendering changed: the primitive is
// this component's own markup, moved.
//
// The adapting is the whole of what is left here, and it is one line of substance: the
// form editor identifies a step by a NUMBER, and deliberately by a number with a gap in it
// (index 5 was Payments & Fees, and the two after it were not renumbered so that every
// "step 6" reference still cites the parity ref it was read from). The primitive keys on a
// stable string instead, because its other callers filter their steps and an array
// position would shift under them. `String(index)` is the whole bridge.
//
// Mode is `free`: this editor edits a form that ALREADY EXISTS, so every step is reachable
// and an organizer fixing the close date should not walk five steps to get there. The
// portal form wizard is the one that passes `disabled`, because while a form is being
// created there is no record yet for a question to belong to (ref 27 draws those steps
// greyed).

import { StepWizardRail, type StepWizardStep } from '@/components/primitives/StepWizard'

import type { EditorStep } from './editor-steps'

export type EditorRailProps = {
  steps: readonly EditorStep[]
  current: number
  visited: readonly number[]
  /**
   * Steps that cannot be reached yet, rendered greyed and unclickable.
   *
   * Empty on the CFP editor. The portal form wizard passes steps 2 and 3 while a form is
   * being CREATED. Passed through as ids rather than recomputed from a `WizardGate`,
   * because this caller knows exactly which steps are locked and why, and deriving it from
   * per-step validity would be a different rule wearing the same name.
   */
  disabled?: readonly number[]
  onSelect: (index: number) => void
}

export function EditorRail({ steps, current, visited, disabled, onSelect }: EditorRailProps) {
  const railSteps: readonly StepWizardStep[] = steps.map((step) => ({
    id: String(step.index),
    title: step.title,
    subtitle: step.subtitle,
    icon: step.icon,
  }))

  return (
    <StepWizardRail
      steps={railSteps}
      current={String(current)}
      label="FORM SETUP"
      ariaLabel="Form setup steps"
      visited={visited.map(String)}
      locked={(disabled ?? []).map(String)}
      onSelect={(id) => onSelect(Number(id))}
    />
  )
}
