// The public wizard's rail labels, with the organizer's own page headings applied.
//
// Why the rail: the builder caps a "Page Heading" at 15 characters, which is a step label's
// budget rather than page copy's, and the three values the screenshots show are `Welcome!`,
// `Submission` and `Participant`. Ref 16's live rail reads `Welcome!`, `Account`,
// `Submission`, `Participant`, `Review`. The two agree exactly, so a page heading is what the
// rail shows for its step.
//
// Pure and its own module so the fallback is unit tested rather than reasoned about: an
// unwritten heading must leave the transcribed label in place, and a whitespace-only one is
// unwritten. `wizard-state.ts` owns the labels and is at the file-size limit, so this sits
// beside it rather than in it.

import type { PublicForm } from '@/features/submissions/public-form'
import { WIZARD_STEP_LABELS, type WizardStepKey } from '@/features/submissions/wizard-state'

type Headings = Pick<PublicForm, 'welcomeHeading' | 'abstractHeading' | 'participantHeading'>

export function railLabels(form: Headings): ReadonlyMap<WizardStepKey, string> {
  const labels = new Map(WIZARD_STEP_LABELS)
  override(labels, 'welcome', form.welcomeHeading)
  override(labels, 'submission', form.abstractHeading)
  override(labels, 'participant', form.participantHeading)
  return labels
}

function override(
  labels: Map<WizardStepKey, string>,
  step: WizardStepKey,
  heading: string | undefined,
): void {
  const trimmed = (heading ?? '').trim()
  if (trimmed.length === 0) return
  labels.set(step, trimmed)
}
