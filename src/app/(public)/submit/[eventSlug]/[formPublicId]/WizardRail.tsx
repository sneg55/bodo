// The step rail: numbered circles, arrow separators, active in the accent colour.
//
// Transcribed off ref 16 and the live walkthrough in docs/parity/public-cfp.md: it is
// a navigation landmark labelled "Submission steps", and a completed step swaps its
// number for a completion marker while upcoming steps keep their numbers.
//
// A COMPLETED step is clickable; an upcoming one is not. The parity doc lists backward
// navigation through the rail as an ambiguity, and the ambiguity is only about how you go
// back, not whether you can: Back is already in the footer, so a done step in the rail
// reaches nothing the visitor cannot already reach, one press at a time. It matters most
// when a draft is restored on step 5, where "Back" four times was the only way to reread
// what was typed. Forward stays closed, because the gate that refuses to advance past an
// incomplete step (see SubmitWizard) is the thing that would be skipped.

import { CheckIcon, ChevronRightIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { WIZARD_STEP_LABELS, type WizardStepKey } from '@/features/submissions/wizard-state'
import { cn } from '@/utils/cn'

export function WizardRail({
  steps,
  current,
  labels,
  onSelect,
}: {
  steps: readonly WizardStepKey[]
  current: WizardStepKey
  /**
   * The organizer's own page headings, from `railLabels(form)`. A step it does not name
   * keeps the transcribed label, which is why this is a whole map rather than three props.
   */
  labels: ReadonlyMap<WizardStepKey, string>
  onSelect: (step: WizardStepKey) => void
}) {
  const activeIndex = steps.indexOf(current)

  return (
    <nav aria-label="Submission steps" className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {steps.map((step, index) => (
        <div key={step} className="flex items-center gap-2">
          {index === 0 ? null : (
            <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          )}
          <RailStep
            label={labels.get(step) ?? WIZARD_STEP_LABELS.get(step) ?? step}
            number={index + 1}
            state={index === activeIndex ? 'active' : index < activeIndex ? 'done' : 'upcoming'}
            onSelect={() => onSelect(step)}
          />
        </div>
      ))}
    </nav>
  )
}

type RailState = 'done' | 'active' | 'upcoming'

function RailStep({
  label,
  number,
  state,
  onSelect,
}: {
  label: string
  number: number
  state: RailState
  onSelect: () => void
}) {
  const body = (
    <div
      // The rail is the one place a screen reader has to be told which step is
      // current, since the visual cue is colour and a filled circle.
      aria-current={state === 'active' ? 'step' : undefined}
      className={cn(
        'flex items-center gap-1.5 text-sm',
        state === 'active' ? 'font-medium text-primary' : 'text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs',
          state === 'active' && 'border-primary text-primary',
          state === 'done' && 'border-primary bg-primary text-primary-foreground',
          state === 'upcoming' && 'border-transparent bg-muted text-muted-foreground',
        )}
      >
        {state === 'done' ? <CheckIcon aria-hidden className="size-3.5" /> : number}
      </span>
      {label}
    </div>
  )

  if (state !== 'done') return body

  // A ghost Button with the rail step inside it, rather than the step given an onClick: the
  // affordance has to be focusable and reachable by keyboard, and this is the one place in
  // the wizard a visitor navigates by pointing at a label.
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-auto px-1 py-0.5"
      onClick={onSelect}
    >
      {body}
      <span className="sr-only">Go back to {label}</span>
    </Button>
  )
}
