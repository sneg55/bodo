'use client'

// Send the portal invitation, for one speaker or a selection of them. SPK-06.
//
// It CONFIRMS first. Mail cannot be recalled, and the two mistakes this is guarding against
// are both easy to make from a roster: a select-all that quietly picked up eighty people
// rather than the three that were meant, and a second press on a selection that was already
// invited. The dialog answers both by naming the number and by saying what re-inviting does.
//
// Its own component rather than more state in the panel, so the panel stays a table.

import { MailIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { inviteSpeakersAction } from '@/features/speakers/invite-actions'

export function InviteSpeakersButton({
  eventId,
  speakerIds,
  onInvited,
}: {
  eventId: string
  speakerIds: readonly string[]
  /** The ids that were stamped, and when, so the roster can patch its rows in place. */
  onInvited: (invited: { ids: readonly string[]; invitedAt: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const count = speakerIds.length

  const send = () => {
    startTransition(async () => {
      const result = await inviteSpeakersAction({ eventId, speakerIds })
      if (!result.ok) {
        toast.error(result.message)
        return
      }

      setOpen(false)
      onInvited({ ids: speakerIds, invitedAt: result.invitedAt })

      // The three outcomes are genuinely different and an organizer needs to be able to tell
      // them apart. Zero queued is the ordinary "you already invited these people" and must
      // not read as a send, and a skip is somebody with no address on file.
      if (result.queued === 0) {
        toast.success('Everyone selected has already been invited')
      } else {
        toast.success(
          result.queued === 1 ? 'Invitation queued' : `${String(result.queued)} invitations queued`,
        )
      }
      if (result.skipped > 0) {
        toast.warning(`${String(result.skipped)} skipped: no email address on file`)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            // 28px tall, and its toolbar neighbours are 8px away, so the area grows
            // vertically only.
            className="hit-area-y"
            disabled={count === 0}
          >
            {/* Trips the Button's own optical padding for a leading icon. See
                DataTableToolbar.tsx, which documents the rule. */}
            <MailIcon data-icon="inline-start" />
            Invite to portal
            {count === 0 ? null : ` (${String(count)})`}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite to the speaker portal</DialogTitle>
          <DialogDescription>
            {count === 1
              ? 'One speaker will be emailed a link to the portal.'
              : `${String(count)} speakers will be emailed a link to the portal.`}{' '}
            Anyone who has already been invited is sent it again.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button onClick={send} disabled={pending}>
            {pending ? 'Sending...' : 'Send invitation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
