'use client'

// What the wizard says about a draft it found in this browser.
//
// Its own file because the wizard owns the state and is already at the size where the
// file-size hook refuses another block, and because there are two shapes to keep straight:
// a draft that HAS been put back, and one waiting to be, which is the case when the visitor
// started filling the form in before the read of localStorage landed.
//
// Neither string is transcribed. The reference has no draft notice at all, which is the gap:
// the run reported arriving on "Review", fully populated from an earlier draft, with the
// footer line "Saved as you type" as the only clue that anything had been restored.

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export type DraftNoticeProps = {
  /** `restored` is already in the form; `pending` is offered and not yet applied. */
  kind: 'restored' | 'pending'
  /**
   * `SESS-<n>` when this draft has also been saved to the submitter's account by Save &
   * finish later. It changes what Start over costs, so it is said rather than left out.
   */
  savedCode?: string
  onResume: () => void
  onDiscard: () => void
}

export function DraftNotice({ kind, savedCode, onResume, onDiscard }: DraftNoticeProps) {
  return (
    <Alert>
      <AlertTitle>
        {kind === 'restored' ? 'We restored your draft' : 'You have a saved draft'}
      </AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>
          {kind === 'restored'
            ? 'This form was filled in from a draft saved in this browser. Use the steps above to review it, or start over.'
            : 'A draft of this form was saved in this browser earlier. You can put it back, or start over.'}
        </span>
        {savedCode === undefined ? null : (
          <span>
            It is also saved to your account as <strong>{savedCode}</strong>. Submitting from here
            sends that same draft, so you will not end up with two. Start over clears this
            browser&apos;s copy only, and {savedCode} stays in your account.
          </span>
        )}
        <span className="flex flex-wrap gap-2">
          {kind === 'pending' ? (
            <Button type="button" size="sm" onClick={onResume}>
              Resume draft
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={onDiscard}>
            Start over
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  )
}
