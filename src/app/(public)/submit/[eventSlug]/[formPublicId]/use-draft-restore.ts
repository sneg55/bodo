'use client'

// Reading the wizard's localStorage copy back after mount, and deciding whether to
// apply it or offer it.
//
// Split out of SubmitWizard for the line budget. The read is deferred by a tick because
// the server has no localStorage, so reading it during render would make the first
// client render disagree with the markup it is hydrating (see SubmitWizard.tsx for the
// full reasoning). A visitor who has already started is OFFERED the draft rather than
// having it applied, because React can replay a click that landed during hydration.

import type { RefObject } from 'react'
import { useEffect, useState } from 'react'

import { isEmptyWizardState, parseWizardState } from '@/features/submissions/wizard-draft'
import type { WizardState } from '@/features/submissions/wizard-state'

export type DraftNoticeKind = 'none' | 'restored' | 'pending'

export type DraftRestore = {
  restored: boolean
  draftNotice: DraftNoticeKind
  pendingDraft: WizardState | undefined
  resumeDraft: () => void
  /** Clears the offer/notice without touching anything else the wizard owns. */
  clearNotice: () => void
}

export function useDraftRestore(
  storageKey: string,
  touched: RefObject<boolean>,
  setState: (state: WizardState) => void,
): DraftRestore {
  const [restored, setRestored] = useState(false)
  const [draftNotice, setDraftNotice] = useState<DraftNoticeKind>('none')
  const [pendingDraft, setPendingDraft] = useState<WizardState | undefined>(undefined)

  useEffect(() => {
    const timer = setTimeout(() => {
      const stored = parseWizardState(window.localStorage.getItem(storageKey))
      // A stored state that is the empty one is not a draft: every browser that has
      // been here holds a stored state, including one that was cleared.
      const draft = stored === undefined || isEmptyWizardState(stored) ? undefined : stored
      if (draft !== undefined && touched.current) {
        setPendingDraft(draft)
        setDraftNotice('pending')
      } else if (draft !== undefined) {
        setState(draft)
        setDraftNotice('restored')
      }
      setRestored(true)
    }, 0)
    return () => clearTimeout(timer)
    // `touched` is a ref and `setState` is the stable setter from the caller's
    // `useState`, so neither changing identity is something this ever has to react to;
    // only a different form's storage key should re-run the read.
  }, [storageKey, touched, setState])

  function resumeDraft(): void {
    if (pendingDraft === undefined) return
    setState(pendingDraft)
    setPendingDraft(undefined)
    setDraftNotice('restored')
  }

  function clearNotice(): void {
    setPendingDraft(undefined)
    setDraftNotice('none')
  }

  return { restored, draftNotice, pendingDraft, resumeDraft, clearNotice }
}
