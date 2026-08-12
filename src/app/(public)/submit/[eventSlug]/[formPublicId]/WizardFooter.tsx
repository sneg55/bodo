'use client'

// The wizard's footer: Back, the primary button, and the explicit save.
//
// Split out of SubmitWizard when that file reached the size budget, and the split is
// where it is because this is the only part of the wizard that is not about the current
// step's content: three controls and one sentence, none of which read the answers.

import { Button } from '@/components/ui/button'
import type { WizardStepKey } from '@/features/submissions/wizard-state'

export type WizardFooterProps = {
  step: WizardStepKey
  index: number
  /** True while the submit is in flight. */
  pending: boolean
  /** True while the draft save is in flight. */
  saving: boolean
  /** False until localStorage has been read back, so nothing promises a save too early. */
  restored: boolean
  onBack: () => void
  onPrimary: () => void
  onSaveDraft: () => void
}

export function WizardFooter({
  step,
  index,
  pending,
  saving,
  restored,
  onBack,
  onPrimary,
  onSaveDraft,
}: WizardFooterProps) {
  const busy = pending || saving
  // Not on Welcome: nothing has been typed there, so the control would refuse every
  // press it was offered for.
  const canSave = step !== 'welcome'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        {index === 0 ? (
          <span />
        ) : (
          <Button type="button" variant="outline" disabled={busy} onClick={onBack}>
            Back
          </Button>
        )}
        <div className="flex items-center gap-2">
          {canSave ? (
            <Button type="button" variant="outline" disabled={busy} onClick={onSaveDraft}>
              {saving ? 'Saving...' : 'Save & finish later'}
            </Button>
          ) : null}
          <Button type="button" disabled={busy} onClick={onPrimary}>
            {primaryLabel(step, index, pending)}
          </Button>
        </div>
      </div>

      {/* Two mechanisms, and the sentence names both. "Saved as you type, in this browser"
          is the localStorage copy, and it is true again rather than only nearly true: an
          evaluation run navigated away and back to find an empty form, because a successful
          Save & finish later used to DELETE that copy. It is kept now, and coming back to
          this URL restores the answers and says which draft they belong to.

          Held back until `restored` so it cannot promise a save before the read-back the
          persist effect waits for. */}
      {restored ? (
        <p className="text-center text-xs text-muted-foreground">
          Saved as you type, in this browser: leave this page and come back and your answers will
          still be here. Use <strong>Save &amp; finish later</strong> to keep it on your account and
          pick it up on any device.
        </p>
      ) : null}
    </div>
  )
}

function primaryLabel(step: WizardStepKey, index: number, pending: boolean): string {
  if (step === 'review') return pending ? 'Submitting...' : 'Submit'
  // `Continue` on the welcome step and `Next` afterwards, per the live walkthrough in
  // docs/parity/public-cfp.md.
  return index === 0 ? 'Continue' : 'Next'
}
