// The steps of the portal form wizard, off refs 27-29.
//
// Titles are the product's own and are not to be improved. The subtitles are RECONSTRUCTED:
// both are cut off in the screenshots (`Name, module, and welcome ...`, `Questions and section
// headin...`) and the parity doc lists their full text under Ambiguities, so each is the
// obvious completion.
//
// **STEP 3, `Settings`, IS GONE** (2026-08-10, on the owner's instruction). Ref 29's subtitle
// named deadlines, login and reminders. None of the three is built and none has a column on
// `Forms` to be built against - a portal form is reached by a speaker who is already signed
// in, so there is no login policy, and reminders are sent against a task's `dueAt` and belong
// to the Tasks surface - so the step had already been narrowed to one control: a
// `Send Confirmation Email` toggle, rendered permanently disabled, above copy promising the
// submitter an email, above a second line explaining that no email is sent. Nothing reads
// `confirmationEmailEnabled` on a portal form at completion time.
//
// The whole pane was therefore a dead switch and an apology for it, under a subtitle naming
// the thing that did not work. Deleting only the apology would have left a disabled toggle
// making a promise with no explanation, which is worse than either. Same call as Exhibitors &
// Sponsors on Event Settings (BUILD_SPEC 5.0b). The one sentence on that pane that described
// something real - that the deadline lives on the task rather than on the form - moved to
// `StepFormSetup`.
//
// The CFP builder's confirmation email is untouched and still works. It is wired to the public
// submit path, which is the whole difference between the two.

import { ClipboardListIcon, SparklesIcon } from 'lucide-react'

import type { EditorStep } from '../forms/[formId]/editor-steps'

export const PORTAL_EDITOR_STEPS: readonly EditorStep[] = [
  {
    index: 1,
    title: 'Form Setup',
    subtitle: 'Name, module, and welcome message',
    icon: SparklesIcon,
  },
  {
    index: 2,
    title: 'Form Questions',
    subtitle: 'Questions and section headings',
    icon: ClipboardListIcon,
  },
]

export const PORTAL_EDITOR_LAST_STEP = 2

/**
 * The heading card's two strings for a step. Here rather than in the editor because they read
 * the list above, and the editor is at its line budget.
 *
 * Both fall back to step 1's copy rather than to an empty string: the pane always renders the
 * card, and a heading that is blank reads as a screen that failed to load.
 */
export function portalStepTitle(step: number): string {
  return stepMeta(step).title
}

export function portalStepSubtitle(step: number): string {
  return stepMeta(step).subtitle
}

function stepMeta(step: number): EditorStep {
  // The fallback indexes the literal above, which always has a step 1 in it.
  return PORTAL_EDITOR_STEPS.find((entry) => entry.index === step) ?? PORTAL_EDITOR_STEPS[0]
}
