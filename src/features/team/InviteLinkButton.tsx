'use client'

// Show a team member's sign-in link, so it can be handed over rather than only mailed.
//
// The link is DISPLAYED as well as copied. A copy button alone is useless to anyone reading
// over a shoulder, to anyone whose clipboard the browser refuses (an insecure origin, a
// permission prompt), and to anyone who needs to paste it somewhere else entirely. It is
// short-lived and the dialog says so, because a credential on screen with no stated lifetime
// is one somebody will save.
//
// `invite-link.ts` decides whether it may be shown at all, and refuses for anybody who is on
// a second event. The refusal comes back as an ordinary message and is rendered here.

import { LinkIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type InviteLink, inviteLinkAction } from '@/features/team/invite-link'

export function InviteLinkButton({
  eventId,
  membershipId,
  disabled,
}: {
  eventId: string
  membershipId: string
  disabled: boolean
}) {
  const [link, setLink] = useState<InviteLink | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [pending, startTransition] = useTransition()

  // Minted on OPEN, never with the row. A magic link is a credential with a fifteen-minute
  // life: minting one per rendered row would put a live credential for every team member
  // into the page payload of anyone who merely visited this screen.
  const load = (open: boolean) => {
    if (!open) return
    setLink(undefined)
    setProblem(undefined)
    startTransition(async () => {
      const result = await inviteLinkAction({ eventId, membershipId })
      if (!result.ok) {
        setProblem(result.message)
        return
      }
      setLink(result)
    })
  }

  const copy = (url: string) => {
    navigator.clipboard.writeText(url).then(
      () => {
        toast.success('Sign-in link copied')
      },
      () => {
        // The link is on screen either way, so this is a nudge rather than a failure.
        toast.error('Could not copy. Select the link and copy it by hand.')
      },
    )
  }

  return (
    <Dialog onOpenChange={load}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Get sign-in link"
                  disabled={disabled}
                  // The middle of the row's send/link/trash trio in TeamTable, which sits at
                  // `gap-0.5`: 34px of horizontal pitch, so this grows vertically only.
                  className="hit-area-y"
                >
                  <LinkIcon />
                </Button>
              }
            />
          }
        />
        <TooltipContent>Get sign-in link</TooltipContent>
      </Tooltip>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign-in link</DialogTitle>
          <DialogDescription>
            {link === undefined
              ? 'A single-use link that signs this person in.'
              : `Single use, for ${link.email}, and it stops working in ${String(link.expiresInMinutes)} minutes.`}
          </DialogDescription>
        </DialogHeader>

        {pending ? <p className="text-sm text-muted-foreground">Minting...</p> : null}
        {problem === undefined ? null : <p className="text-sm text-destructive">{problem}</p>}

        {link === undefined ? null : (
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={link.url}
              aria-label="Sign-in link"
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              onClick={() => {
                copy(link.url)
              }}
            >
              Copy
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
