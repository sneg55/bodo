'use client'

// The shared wizard frame: a step rail, the current step's body, and a footer.
//
// BUILD_SPEC names StepWizard as one of the five primitives that are built once and
// reused. It did not exist, so the form builder grew its own rail
// (`forms/[formId]/EditorRail.tsx`), and the portal create flow (5.0c) and the import flow
// (5.0e) would have made three. This is that rail generalized; EditorRail delegates its
// rendering here rather than being forked a third time.
//
// Composed from `Button variant="ghost"`, per the component map: a wizard rail is a nav
// list, not a Tabs strip, and hand-rolling one would be a `role="tab"` lint error anyway.
//
// Controlled, deliberately. The step lives in the caller's state because every caller
// needs it for something else too: the portal wizard's review step reruns the match
// against the filters entered two steps back, and the import wizard's preview is a server
// round trip that has to survive a step change. A primitive owning that state would make
// both of those a read out of a child.

import { CheckIcon, type LucideIcon } from 'lucide-react'
import { type ReactNode, useId } from 'react'

import {
  canAdvance,
  isFinalStep,
  lockedSteps,
  neighbourStep,
  stepPosition,
  visitedSteps,
  type WizardGate,
  type WizardStep,
} from '@/components/primitives/step-wizard'
import { Button } from '@/components/ui/button'
import { cn } from '@/utils/cn'

/** A step plus the icon the rail draws for it while it is unvisited. */
export type StepWizardStep = WizardStep & { icon?: LucideIcon }

/**
 * The enter half of a step change, split in two and staggered.
 *
 * A keyframe rather than a transition, which is the one case keyframes are for: a staged
 * sequence that runs once per change with nothing to interrupt it. The body carries the
 * change and goes first; the blockers line, which says why Continue is still dead, follows
 * 100ms later so the two read as one movement. 8px of travel, not the panel's height: the
 * frame around the body is not moving.
 *
 * The rail and the footer controls are deliberately NOT keyed on the step and so do not
 * replay: remounting the footer would drop focus off Continue on every advance, which is the
 * whole keyboard path through a wizard.
 */
const STEP_ENTER =
  'animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-[cubic-bezier(0.2,0,0,1)]'

export type StepWizardRailProps = {
  steps: readonly StepWizardStep[]
  current: string
  /** Small caps heading above the rail, e.g. `FORM SETUP`. Vendor wording where there is any. */
  label?: string
  /** Accessible name for the nav landmark. Defaults to the label, then to "Steps". */
  ariaLabel?: string
  visited: readonly string[]
  locked: readonly string[]
  onSelect: (id: string) => void
}

/**
 * Three states, transcribed off parity ref 06: the current step is a filled card, a step
 * already visited carries a checkmark, and a step ahead is greyed.
 *
 * Exported on its own as well as through `StepWizard`, because the form editor uses the
 * rail without the footer: it edits a form that already exists, so it has Save rather than
 * Back and Continue.
 */
export function StepWizardRail({
  steps,
  current,
  label,
  ariaLabel,
  visited,
  locked,
  onSelect,
}: StepWizardRailProps) {
  return (
    <nav aria-label={ariaLabel ?? label ?? 'Steps'} className="flex flex-col gap-1">
      {label !== undefined && (
        <p className="px-2 text-xs font-medium tracking-wide text-muted-foreground">{label}</p>
      )}
      {steps.map((step) => {
        const active = step.id === current
        const done = !active && visited.includes(step.id)
        const Icon = step.icon
        return (
          <Button
            key={step.id}
            variant={active ? 'default' : 'ghost'}
            disabled={locked.includes(step.id)}
            className={cn(
              'h-auto justify-start gap-2 whitespace-normal px-2 py-2 text-left',
              !active && !done && 'text-muted-foreground',
            )}
            onClick={() => onSelect(step.id)}
          >
            <span className="mt-0.5 shrink-0">
              {done ? (
                <CheckIcon />
              ) : Icon !== undefined ? (
                <Icon />
              ) : (
                <StepNumber steps={steps} id={step.id} />
              )}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">{step.title}</span>
              {step.subtitle !== undefined && (
                <span className={cn('text-xs', active ? 'opacity-80' : 'text-muted-foreground')}>
                  {step.subtitle}
                </span>
              )}
            </span>
          </Button>
        )
      })}
    </nav>
  )
}

/** The fallback glyph when a step declares no icon. 1-based, because a rail is not an array. */
function StepNumber({ steps, id }: { steps: readonly StepWizardStep[]; id: string }) {
  return <span className="text-xs tabular-nums">{stepPosition(steps, id) + 1}</span>
}

export type StepWizardProps = {
  steps: readonly StepWizardStep[]
  current: string
  onCurrentChange: (id: string) => void
  gate: WizardGate
  label?: string
  ariaLabel?: string
  children: ReactNode
  /**
   * What replaces Continue on the last step: `Create Portal`, `Import`, and so on.
   *
   * A node rather than a label plus a handler, because the final action is where the two
   * wizards differ most: one is a Server Action form submit, the other opens an
   * `AlertDialog` first. A primitive that owned the button would own that difference too.
   */
  finalAction?: ReactNode
  /** Rendered beside Back, e.g. Cancel. */
  secondaryAction?: ReactNode
  /**
   * Why this step cannot be left yet, in the caller's own words.
   *
   * The gate itself is `gate.completed`; this is the sentence beside it. Empty (the
   * default) leaves the gate drawn but unexplained, which is what every caller did before
   * this existed. Anything in it is printed next to Continue and named as the control's
   * description, because a disabled button with no explanation is the worst version of a
   * gate (`src/features/submissions/wizard-gating.ts:3`).
   */
  blockers?: readonly string[]
  /**
   * A round trip in flight: Back, Continue and the rail all go dead without the step
   * changing. The CRM import wizard's preview is a server call reached BY arriving at the
   * step, so the wizard has a busy state that no click of its own started.
   */
  busy?: boolean
}

/**
 * Rail on the left, step body on the right, Back and Continue underneath.
 *
 * Continue is disabled rather than hidden when the current step is incomplete, and that is
 * the accessible reading of the same rule the rail's locked steps encode: a hidden control
 * tells somebody nothing about why they are stuck, while a disabled one keeps its position
 * and its label. What is INVALID is the caller's to say, next to the field that says it.
 *
 * A disabled Continue is still `focusableWhenDisabled`, which is a deliberate change to
 * base-ui's default of `false` (`node_modules/@base-ui/react/button/Button.d.ts:21`). Left
 * at the default, a gated Continue drops out of the tab order entirely, so a keyboard or
 * screen-reader user tabbing off the last field of a blocked step reaches nothing and
 * hears nothing: the control is gone and the `blockers` beside it are orphaned. With the
 * flag on, base-ui writes `aria-disabled="true"` and `data-disabled=""` instead of the
 * native attribute, and still refuses click, Enter and Space
 * (`internals/use-button/useButton.js`), so nothing becomes pressable.
 *
 * The knock-on has to be handled here: shadcn's `Button` keys its `disabled:` Tailwind
 * variants off the native `:disabled` pseudo-class (`src/components/ui/button.tsx`), which
 * stops matching once the attribute is gone, so the same look is restored off
 * `aria-disabled`. The two are keyed off one binding below and must never be flipped
 * apart: the prop without the classes is a dead control that looks live.
 */
export function StepWizard({
  steps,
  current,
  onCurrentChange,
  gate,
  label,
  ariaLabel,
  children,
  finalAction,
  secondaryAction,
  blockers = [],
  busy = false,
}: StepWizardProps) {
  const locked = lockedSteps(steps, current, gate)
  const atFirst = stepPosition(steps, current) <= 0
  const final = isFinalStep(steps, current)
  const blockersId = useId()
  // One binding, two consumers: the `focusableWhenDisabled` prop and the `aria-disabled:`
  // classes that compensate for it. Not `busy`, which is reached by activating a control
  // that then goes natively disabled; that is a separate question, recorded but not
  // answered here.
  const gated = !busy && !canAdvance(steps, current, gate)

  return (
    <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
      <StepWizardRail
        steps={steps}
        current={current}
        label={label}
        ariaLabel={ariaLabel}
        visited={visitedSteps(steps, current)}
        locked={busy ? steps.map((step) => step.id) : locked}
        onSelect={onCurrentChange}
      />
      <div className="flex min-w-0 flex-col gap-6">
        {/* Keyed on the step so the enter replays on every change. Safe to remount: the
            wizard is controlled and every caller's step bodies are already separate elements
            per step, so nothing that survives a step change lives in here. */}
        <div key={current} className={cn('min-w-0', STEP_ENTER)}>
          {children}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            {secondaryAction}
            <Button
              variant="outline"
              disabled={atFirst || busy}
              onClick={() => onCurrentChange(neighbourStep(steps, current, -1))}
            >
              Back
            </Button>
          </div>
          {final ? (
            finalAction
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-3">
              {gated && blockers.length > 0 ? (
                // Beside the control, not instead of it, and in a live region so it is
                // announced when it appears rather than only when somebody looks here.
                // Keyed alongside the body so it replays as the second beat of the same
                // change rather than sitting still when only its text swaps.
                // `fill-mode-backwards` holds it hidden through the 100ms it waits.
                <div
                  key={current}
                  id={blockersId}
                  role="status"
                  className={cn(
                    'text-sm text-pretty text-muted-foreground',
                    STEP_ENTER,
                    'delay-100 fill-mode-backwards',
                  )}
                >
                  {blockers.map((blocker, position) => (
                    // Keyed by position, not by the message: a per-row validator produces
                    // the same sentence twice and keying by text would drop one of them.
                    <div key={`${position}-${blocker}`}>{blocker}</div>
                  ))}
                </div>
              ) : null}
              <Button
                disabled={gated || busy}
                focusableWhenDisabled={gated}
                aria-describedby={gated && blockers.length > 0 ? blockersId : undefined}
                className={
                  gated ? 'aria-disabled:pointer-events-none aria-disabled:opacity-50' : undefined
                }
                onClick={() => onCurrentChange(neighbourStep(steps, current, 1))}
              >
                Continue
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
