'use client'

// The repair control on the no-default-portal card.
//
// It replaces a paragraph that told an organizer to add the missing row in Airtable and wait
// a minute for the list to notice. That was a dead end wearing an explanation: the state is a
// data gap the product knows exactly how to close, since every event creator already writes
// this row, so the honest surface is a button rather than an instruction to leave.
//
// `router.refresh()` and not an optimistic patch. The write creates the precondition every
// other portal control refuses to run without, so the screen has to come back from the
// server having actually read it, rather than being told it is now fine.

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { createDefaultPortalAction } from '@/features/portal-config/repair-actions'
import { settled } from '@/features/portal-config/settled'

export function CreateDefaultPortalButton({ eventId }: { eventId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  /** The last refusal, kept on screen rather than only toasted. As in `TeamPanel`. */
  const [problem, setProblem] = useState<string | undefined>(undefined)

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        disabled={pending}
        onClick={() => {
          setProblem(undefined)
          startTransition(async () => {
            // Through `settled`, like every other portal action call: this button is the
            // only way out of the no-default-portal screen, so a rejection that left it
            // disabled with nothing said would be a dead end on a repair screen.
            const result = await settled(createDefaultPortalAction(eventId))
            if (!result.ok) {
              setProblem(result.error)
              toast.error(result.error)
              return
            }
            toast.success('Default portal created')
            router.refresh()
          })
        }}
      >
        Create the default portal
      </Button>

      {problem === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </div>
  )
}
