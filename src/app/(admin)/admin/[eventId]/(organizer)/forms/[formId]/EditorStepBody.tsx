'use client'

// Which step is on screen, plus the header card every step opens with (parity refs 06-15).
//
// A switch rather than a lookup table, and exhaustive on the step numbers, so adding an
// eighth step is a type error here instead of a blank pane.

import { Card } from '@/components/ui/card'
import type { NamedOption } from '@/features/forms/builder/defaults'
import type { FormDraft } from '@/features/forms/builder/draft'
import type { DraftPatch } from '@/features/forms/builder/draft-edits'
import type { RecipientOption } from '@/features/team/recipients'

import type { EditorStep } from './editor-steps'
import { StepNotifications } from './StepNotifications'
import { StepQuestions } from './StepQuestions'
import { StepSettings } from './StepSettings'
import { StepSetup } from './StepSetup'
import { StepWelcome } from './StepWelcome'

export type StepProps = {
  /** For the link that sends an organizer to the Library when a category list is empty. */
  eventId: string
  /**
   * The EVENT's IANA zone, which the close date on step 6 is read and written in.
   *
   * `draft.closeDate` is wall-clock text with no zone attached (see `draft.ts`), so the
   * control that edits it needs to be told which wall clock that is. Without it the field
   * would print the wrong zone abbreviation beside a published deadline.
   */
  eventTimeZone: string
  draft: FormDraft
  /**
   * A patch, or a function OF THE CURRENT DRAFT that returns one.
   *
   * Every edit that depends on what is already in the draft must use the function form. See
   * the header of `draft-edits.ts`: computing from a rendered copy is what dropped questions.
   */
  patch: (next: DraftPatch) => void
  trackOptions: readonly NamedOption[]
  tagOptions: readonly NamedOption[]
}

export type EditorStepBodyProps = StepProps & {
  step: number
  steps: readonly EditorStep[]
  /** Only step 7 takes these, so they travel beside `StepProps` rather than inside it. */
  recipients: readonly RecipientOption[]
}

export function EditorStepBody({ step, steps, recipients, ...common }: EditorStepBodyProps) {
  const meta = steps.find((entry) => entry.index === step)

  return (
    <div className="flex flex-col gap-4">
      {meta === undefined ? null : (
        <Card className="gap-1 px-4 py-3">
          <h2 className="text-sm font-semibold">{meta.title}</h2>
          <p className="text-xs text-muted-foreground">{meta.subtitle}</p>
        </Card>
      )}
      <Body step={step} recipients={recipients} {...common} />
    </div>
  )
}

function Body({
  step,
  recipients,
  ...common
}: StepProps & { step: number; recipients: readonly RecipientOption[] }) {
  switch (step) {
    case 1:
      return <StepSetup {...common} />
    case 2:
      return <StepWelcome {...common} />
    case 3:
      return <StepQuestions {...common} kind="abstract" />
    case 4:
      return <StepQuestions {...common} kind="participant" />
    // No case 5: Payments & Fees is not built and no longer in the rail, so the number is
    // unreachable rather than blank. See the note in `editor-steps.ts`.
    case 6:
      return <StepSettings {...common} />
    default:
      return <StepNotifications {...common} recipients={recipients} />
  }
}
