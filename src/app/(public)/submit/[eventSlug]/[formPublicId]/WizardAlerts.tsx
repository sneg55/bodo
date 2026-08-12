// The failure banners under the step body.
//
// A failed submit and a failed draft save are told apart on purpose, in state and in
// render. They used to share one `failure` value and one `reveal(current)` call, and
// that is what made "Save & finish later" look like it ran the full form gate (CFP-07):
// a draft save that was refused only for a missing email also pulled in `stepProblems`,
// the FULL required-field list `advance()`/`submit()` gate the Next/Submit buttons
// with, and stamped the banner "Not submitted" over a control that was never trying to
// submit. A draft is refused only for its own, narrower reasons (no address to bind it
// to, an answered field that is malformed), so its alert carries only its own problems.

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { Problem } from '@/features/forms/validate'
import type { SubmitFailure } from '@/features/submissions/actions'
import type { SaveDraftFailure } from '@/features/submissions/draft-actions'

import { ProblemList } from './ProblemList'

export type WizardAlertsProps = {
  failure: SubmitFailure | undefined
  draftFailure: SaveDraftFailure | undefined
  /** The current step's own gate (`stepProblems`), shown once the step is revealed. */
  stepProblems: readonly Problem[]
  showStepProblems: boolean
}

export function WizardAlerts({
  failure,
  draftFailure,
  stepProblems,
  showStepProblems,
}: WizardAlertsProps) {
  return (
    <>
      {failure === undefined ? null : (
        <Alert variant="destructive">
          <AlertTitle>Not submitted</AlertTitle>
          <AlertDescription>{failure.message}</AlertDescription>
        </Alert>
      )}
      {showStepProblems ? (
        <ProblemList
          problems={failure === undefined ? stepProblems : [...stepProblems, ...failure.problems]}
        />
      ) : null}

      {draftFailure === undefined ? null : (
        <Alert variant="destructive">
          <AlertTitle>Draft not saved</AlertTitle>
          <AlertDescription>{draftFailure.message}</AlertDescription>
        </Alert>
      )}
      {draftFailure !== undefined && draftFailure.problems.length > 0 ? (
        <ProblemList problems={draftFailure.problems} />
      ) : null}
    </>
  )
}
