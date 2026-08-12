'use client'

// The five-step public wizard: Welcome, Account, Submission, Participant, Review.
//
// All of the state lives here and every step is a presentational child (see StepBody), because the
// Review step has to recap what the Submission and Participant steps collected and a
// per-step store would need three of them to agree. The store is persisted to
// localStorage (BUILD_SPEC section 5.1) so a reload does not lose a half-written
// abstract, which is the difference between a speaker retyping 5,000 characters and
// giving up.
//
// Gating: the primary button is never disabled, but it refuses to advance while the
// step has blockers and reveals them on the attempt. A disabled Next with no
// explanation is the failure this avoids, and the gate is just as real: nothing
// advances, and the server re-validates everything regardless of what this allowed.

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'

import { Separator } from '@/components/ui/separator'
import type { SubmitFailure, SubmitSuccess } from '@/features/submissions/actions'
import { submitCfp } from '@/features/submissions/actions'
import type { SaveDraftFailure, SaveDraftSuccess } from '@/features/submissions/draft-actions'
import { saveCfpDraft } from '@/features/submissions/draft-actions'
import type { PublicForm } from '@/features/submissions/public-form'
import { railLabels } from '@/features/submissions/rail-labels'
import { serializeWizardState } from '@/features/submissions/wizard-draft'
import { stepProblems, submitProblems } from '@/features/submissions/wizard-gating'
import type { WizardState, WizardStepKey } from '@/features/submissions/wizard-state'
import {
  initialWizardState,
  seedPrimaryParticipant,
  wizardSteps,
  wizardStorageKey,
} from '@/features/submissions/wizard-state'

import { DraftNotice } from './DraftNotice'
import { DraftSavedCard } from './DraftSavedCard'
import { StepBody } from './StepBody'
import { SuccessCard } from './SuccessCard'
import { useDraftRestore } from './use-draft-restore'
import { WizardAlerts } from './WizardAlerts'
import { WizardFooter } from './WizardFooter'
import { WizardRail } from './WizardRail'
import { payloadFrom } from './wizard-payload'

export type SubmitWizardProps = {
  form: PublicForm
  /**
   * The address this browser has PROVED it controls, or undefined for a stranger.
   *
   * Resolved on the server (`sessionSpeaker` in features/auth/wiring.ts) and passed in,
   * because a client component cannot read the session cookie: it is httpOnly, which is what
   * makes it worth anything. Used only to word the Account step; nothing here is a check.
   * The check that matters is `submitterBinding` on the write.
   */
  signedInEmail?: string
  loginHref: string
}

export function SubmitWizard({ form, signedInEmail, loginHref }: SubmitWizardProps) {
  const [state, setState] = useState<WizardState>(initialWizardState)
  const [revealed, setRevealed] = useState<readonly WizardStepKey[]>([])
  const [success, setSuccess] = useState<SubmitSuccess | undefined>(undefined)
  const [failure, setFailure] = useState<SubmitFailure | undefined>(undefined)
  // Deliberately its own state rather than reusing `failure`. A draft save is not a
  // submit, and the two used to share both the state and the render: a refused draft
  // set `failure` and called `reveal(current)`, which pulled in `stepProblems`, the
  // FULL required-field gate written for the Next/Submit buttons. That is what made
  // "Save & finish later" with only a title typed look like it ran full validation:
  // the banner said "Not submitted" and the list under it was every unanswered
  // required question on the step, none of which a draft needs. See CFP-07.
  const [draftFailure, setDraftFailure] = useState<SaveDraftFailure | undefined>(undefined)
  const [draftSaved, setDraftSaved] = useState<SaveDraftSuccess | undefined>(undefined)
  const [pending, startTransition] = useTransition()
  const [saving, startSaving] = useTransition()

  const storageKey = wizardStorageKey(form.publicId)

  // Whether the visitor has changed anything yet, as a ref rather than state because
  // nothing renders from it and flipping it must not cost a render on every keystroke.
  const touched = useRef(false)
  const update = useCallback((updater: (previous: WizardState) => WizardState) => {
    touched.current = true
    setState(updater)
  }, [])

  // Read back after mount and offered rather than applied over a visitor who has
  // already started. See use-draft-restore.ts for the mechanism and why.
  const { restored, draftNotice, pendingDraft, resumeDraft, clearNotice } = useDraftRestore(
    storageKey,
    touched,
    setState,
  )

  useEffect(() => {
    // Guarded on `restored` so the empty initial state cannot overwrite a stored one
    // in the tick before it is read back, and on `pendingDraft` so an offer nobody has
    // answered yet is still there to accept.
    if (!restored || pendingDraft !== undefined) return
    window.localStorage.setItem(storageKey, serializeWizardState(state))
  }, [restored, pendingDraft, state, storageKey])

  function discardDraft(): void {
    window.localStorage.removeItem(storageKey)
    setState(initialWizardState())
    clearNotice()
    setRevealed([])
    setFailure(undefined)
    setDraftFailure(undefined)
    touched.current = false
  }

  const steps = wizardSteps(form)
  // A stored step can name a step this form no longer has, if the organizer turned
  // participants off while a draft was sitting in a browser.
  const current: WizardStepKey = steps.includes(state.step) ? state.step : 'welcome'
  const index = steps.indexOf(current)
  const problems = success === undefined ? stepProblems(form, state, current) : []
  const showProblems = revealed.includes(current)

  function goTo(step: WizardStepKey): void {
    setFailure(undefined)
    setDraftFailure(undefined)
    update((previous) => {
      const moved = { ...previous, step }
      return step === 'participant' ? seedPrimaryParticipant(moved, form) : moved
    })
  }

  function reveal(step: WizardStepKey): void {
    setRevealed((previous) => (previous.includes(step) ? previous : [...previous, step]))
  }

  function advance(): void {
    if (problems.length > 0) {
      reveal(current)
      return
    }
    const next = steps.at(index + 1)
    if (next !== undefined) goTo(next)
  }

  function submit(): void {
    const blockers = submitProblems(form, state)
    if (blockers.length > 0) {
      reveal('review')
      return
    }
    setDraftFailure(undefined)
    startTransition(async () => {
      const outcome = await submitCfp({
        eventSlug: form.eventSlug,
        formPublicId: form.publicId,
        payload: payloadFrom(form, state),
      })
      if (outcome.ok) {
        // Cleared only on success. A failed submit must keep the draft, since the
        // speaker still has to fix something and try again.
        window.localStorage.removeItem(storageKey)
        setSuccess(outcome)
        return
      }
      reveal('review')
      setFailure(outcome)
    })
  }

  /**
   * Save the work as a real draft row, bound to the submitter's address.
   *
   * The localStorage copy is KEPT, and that reversal is the whole of CFP-07's second half.
   * Clearing it made this the one action in the wizard that destroyed the visitor's own
   * answers: the card said "sign in to finish", the form URL they were already on came back
   * empty, and sign-in here is magic-link only. The objection to keeping it was a second
   * copy that could diverge, and the server no longer treats the two as different work: a
   * second save updates the same row, and `submitCfp` PROMOTES that row instead of filing
   * another (features/submissions/draft-promote.ts). One abstract, one record.
   *
   * Nothing is gated client-side. The server decides whether there is an address and
   * whether there is anything worth saving. A refusal lands in `draftFailure`, its own
   * state with its own alert (WizardAlerts.tsx), never in `failure` and never behind
   * `reveal(current)`: that combination is what used to run the full step gate
   * (`stepProblems`) over a save this button promises can be partial. See CFP-07.
   */
  function saveDraft(): void {
    setDraftFailure(undefined)
    startSaving(async () => {
      const outcome = await saveCfpDraft({
        eventSlug: form.eventSlug,
        formPublicId: form.publicId,
        payload: payloadFrom(form, state),
      })
      if (outcome.ok) {
        update((previous) => ({ ...previous, savedCode: outcome.code }))
        setDraftSaved(outcome)
        return
      }
      setDraftFailure(outcome)
    })
  }

  if (success !== undefined) return <SuccessCard form={form} result={success} />
  if (draftSaved !== undefined) {
    return (
      <DraftSavedCard
        result={draftSaved}
        email={state.email.trim()}
        onKeepEditing={() => setDraftSaved(undefined)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <WizardRail
        steps={steps}
        current={current}
        labels={railLabels(form)}
        onSelect={(step) => goTo(step)}
      />
      <Separator />

      {draftNotice === 'none' ? null : (
        <DraftNotice
          kind={draftNotice}
          savedCode={(pendingDraft ?? state).savedCode}
          onResume={resumeDraft}
          onDiscard={discardDraft}
        />
      )}

      <StepBody
        form={form}
        state={state}
        step={current}
        problems={showProblems ? problems : []}
        signedInEmail={signedInEmail}
        loginHref={loginHref}
        setState={update}
      />

      <WizardAlerts
        failure={failure}
        draftFailure={draftFailure}
        stepProblems={problems}
        showStepProblems={showProblems}
      />

      {/* The Save control binds the work to an address, which is the half localStorage can
          never do: a copy in this browser does not survive a different device. */}
      <WizardFooter
        step={current}
        index={index}
        pending={pending}
        saving={saving}
        restored={restored}
        onBack={() => {
          const previous = steps.at(index - 1)
          if (previous !== undefined) goTo(previous)
        }}
        onPrimary={() => (current === 'review' ? submit() : advance())}
        onSaveDraft={saveDraft}
      />
    </div>
  )
}
