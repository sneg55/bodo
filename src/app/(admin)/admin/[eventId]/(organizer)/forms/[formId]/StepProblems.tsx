'use client'

// What `checkDraft` found, shown on the step that owns it.
//
// This exists because of the CFP-02 evaluation finding: saving the form raised
// `"Tags" offers none of this event's categories.` as a toast on EVERY save, about a
// question the organizer had not touched, from the Form Settings step where there is no
// question to open. The warning itself is correct (a `multiselect` with no options renders
// as a control the speaker cannot answer), so the fix is not to stop checking. It is to
// stop reporting a standing condition as if it were news, and to report it where it can be
// acted on instead.
//
// So the problems are computed from the LIVE draft in the client rather than being
// returned by the save, and the save no longer toasts warnings at all. Every
// `BuilderProblem` already carries the step number it belongs to, which is the whole
// mechanism: the problems for the current step render above it, and the ones for other
// steps become a button that goes there.
//
// The check is the same function the Server Action runs (`checkDraft`), on the same
// normalized draft, so this cannot show a different answer from the one the save enforces.
// It is pure and touches no binding, which is what makes it importable here.

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { BuilderProblem } from '@/features/forms/builder/checks'

import type { EditorStep } from './editor-steps'

export type StepProblemsProps = {
  problems: readonly BuilderProblem[]
  step: number
  steps: readonly EditorStep[]
  onSelect: (index: number) => void
}

export function StepProblems({ problems, step, steps, onSelect }: StepProblemsProps) {
  const here = problems.filter((problem) => problem.step === step)
  const elsewhere = steps.filter(
    (entry) => entry.index !== step && problems.some((problem) => problem.step === entry.index),
  )
  if (here.length === 0 && elsewhere.length === 0) return null

  // Three states, because there are two gates now. An error refuses the SAVE, so it is the
  // loudest. A `blocksPublish` warning saves fine and refuses the PUBLISH, and calling that
  // one "worth fixing" is how an organizer met the refusal as a surprise toast fired by a
  // button on another screen. Everything else is advice.
  const blocking = here.some((problem) => problem.severity === 'error')
  const beforePublish = here.some((problem) => problem.blocksPublish === true)

  return (
    <Alert variant={blocking ? 'destructive' : 'default'}>
      {here.length === 0 ? null : (
        <AlertTitle>
          {blocking
            ? 'Fix these before saving'
            : beforePublish
              ? 'Fix these before publishing'
              : 'Worth fixing before this form goes out'}
        </AlertTitle>
      )}
      <AlertDescription>
        {here.length === 0 ? null : (
          <ul className="list-disc pl-4">
            {here.map((problem) => (
              <li key={`${problem.step}-${problem.fieldId ?? ''}-${problem.message}`}>
                {problem.message}
              </li>
            ))}
          </ul>
        )}
        {elsewhere.length === 0 ? null : (
          <div className="flex flex-wrap items-center gap-1">
            {/* Named rather than counted, because the step title is what the rail shows
                and the button below goes straight there. */}
            <span>{here.length === 0 ? 'Something to fix on' : 'Also on'}</span>
            {elsewhere.map((entry) => (
              <Button
                key={entry.index}
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => onSelect(entry.index)}
              >
                {entry.title}
              </Button>
            ))}
          </div>
        )}
      </AlertDescription>
    </Alert>
  )
}
