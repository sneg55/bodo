'use client'

// The two things a speaker can actually do to their own submission from the portal.
//
// Submit turns a draft into `pending`, and withdraw is available while it is still a
// draft or pending. Both are legal moves in `SUBMISSION_TRANSITIONS`, both are refused
// server-side for any other status, and both re-check record ownership in the action
// rather than trusting that this component only rendered for the owner.
//
// Editing the submission BODY is not here either, and that is a layout decision rather
// than a missing feature: the answers are edited where they are read, in the answers
// section (`SubmissionBodyForm`), which is the only place the questions and their stored
// values are on screen together. These two buttons act on the submission as a whole.

import { useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { submitDraftAction, withdrawSubmissionAction } from '@/features/portal/actions'

export type SubmissionActionsProps = {
  code: string
  canSubmit: boolean
  canWithdraw: boolean
}

export function SubmissionActions({ code, canSubmit, canWithdraw }: SubmissionActionsProps) {
  const [pending, startTransition] = useTransition()

  function run(action: (formData: FormData) => Promise<{ ok: boolean; message: string }>) {
    const formData = new FormData()
    formData.set('code', code)
    startTransition(async () => {
      const result = await action(formData)
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    })
  }

  if (!canSubmit && !canWithdraw) return null

  return (
    <div className="flex flex-wrap gap-2">
      {canSubmit ? (
        // 28px text buttons that are already wide, so the band. The two of them measure
        // about 207px side by side and the card content is never narrower than 240px, so
        // the `flex-wrap` here does not actually wrap and there is no row below to cross;
        // above, the edit-mode notice sits 16px off across the card's `space-y-4`.
        <Button
          size="sm"
          className="hit-area-y"
          disabled={pending}
          onClick={() => {
            run(submitDraftAction)
          }}
        >
          Submit for review
        </Button>
      ) : null}
      {canWithdraw ? (
        <Button
          variant="outline"
          size="sm"
          className="hit-area-y"
          disabled={pending}
          onClick={() => {
            run(withdrawSubmissionAction)
          }}
        >
          Withdraw
        </Button>
      ) : null}
    </div>
  )
}
