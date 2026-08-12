'use client'

// Runs one of the organizer's cast Server Actions, reports it, and re-renders the roster
// the server now holds.
//
// Its own module because two components need it (the panel's Remove, and both dialogs) and
// importing it from either of them would make the pair circular.
//
// `router.refresh()` after a success, which every sibling that mutates admin data does and
// which `features/portal/TaskCompletion.tsx` documents at length: the action expires the
// SERVER cache tags, and the client router still holds the RSC payload it already rendered.
// Without the refresh the roster on screen is the roster from before the press, which on
// this surface reads exactly like the bug it was added to fix.

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'

import type { RosterActionResult } from '@/features/submissions/roster-actions'

export function useRosterAction(): {
  pending: boolean
  run: (
    action: (formData: FormData) => Promise<RosterActionResult>,
    formData: FormData,
    onDone?: () => void,
  ) => void
} {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function run(
    action: (formData: FormData) => Promise<RosterActionResult>,
    formData: FormData,
    onDone?: () => void,
  ): void {
    startTransition(async () => {
      const result = await action(formData)
      if (result.ok) {
        toast.success(result.message)
        onDone?.()
        router.refresh()
        return
      }
      toast.error(result.message)
    })
  }

  return { pending, run }
}
