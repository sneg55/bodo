'use client'

// Which step is on screen, plus the heading card every step opens with.
//
// Split out of `PortalFormEditor` at its line budget, and it is the same seam the CFP editor
// already has in `../forms/[formId]/EditorStepBody`: that file is the shell (header, rail,
// footer, the writes), this is the pane. Keeping the two surfaces the same shape is the point,
// since a reader who has understood one is meant to recognise the other.

import { Card } from '@/components/ui/card'
import type { FormDraft } from '@/features/forms/builder/draft'
import type { DraftPatch } from '@/features/forms/builder/draft-edits'

import { portalStepSubtitle, portalStepTitle } from './editor-steps'
import { StepFormQuestions } from './StepFormQuestions'
import { StepFormSetup } from './StepFormSetup'

export type PortalStepBodyProps = {
  step: number
  draft: FormDraft
  patch: (next: DraftPatch) => void
}

export function PortalStepBody({ step, draft, patch }: PortalStepBodyProps) {
  return (
    <div className="flex flex-col gap-4 pb-4">
      <Card className="gap-1 px-4 py-3">
        <h2 className="text-sm font-semibold">{portalStepTitle(step)}</h2>
        <p className="text-xs text-muted-foreground">{portalStepSubtitle(step)}</p>
      </Card>
      <Body step={step} draft={draft} patch={patch} />
    </div>
  )
}

// Step 3 (`Settings`) was deleted rather than left inert; ./editor-steps.ts says why. Step 1
// is still the fallback, so a stale `?step=3` in somebody's history lands on Form Setup
// instead of a blank pane.
function Body({ step, draft, patch }: PortalStepBodyProps) {
  if (step === 2) return <StepFormQuestions draft={draft} patch={patch} />
  return <StepFormSetup draft={draft} patch={patch} />
}
