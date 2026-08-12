'use client'

// One card in ref 32's list: the name, a status badge, a duplicate icon and a `···` menu.
//
// THE MENU'S CONTENTS ARE AUTHORED. docs/parity/cms-embeds.md records the overflow menu as an
// ambiguity ("delete? rename? disable?") because ref 32 has it closed, so this is the minimum
// that is useful and reversible rather than a guess at a longer list: Edit (which is where
// renaming lives, since the Name field is in ref 33's Type section and not on the card),
// Enable/Disable, and Delete. No "Copy URL", because a disabled embed's URL 404s and an item
// that hands over a dead link is worse than no item.
//
// Delete goes through an AlertDialog. An embed's URL may be pasted in somebody else's live HTML,
// so deleting one takes a feed off a third-party page, and that is not an undoable click.

import { CopyIcon, MoreHorizontalIcon, PencilIcon, PowerIcon, Trash2Icon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  deleteEmbedAction,
  duplicateEmbedAction,
  setEmbedEnabledAction,
} from '@/features/cms/actions'
import type { EmbedListRow } from '@/features/cms/list-model'

export function EmbedCard({ eventId, row }: { eventId: string; row: EmbedListRow }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const editHref = `/admin/${eventId}/cms/embeds/${row.id}`

  const run = (work: () => Promise<{ ok: boolean; message: string }>) => {
    startTransition(async () => {
      const result = await work()
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
        return
      }
      toast.error(result.message)
    })
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Link href={editHref} className="truncate font-medium hover:underline">
            {row.name}
          </Link>
          {/* The view and the id, which is what the search box says it matches on. Neither is
              in ref 32's card, and both are here because one Styled HTML embed can be any of
              five views and a card that shows only a name cannot be told apart from its own
              duplicate. */}
          <p className="truncate text-xs text-muted-foreground">
            {row.viewLabel} · {row.publicId}
          </p>
        </div>

        <Badge variant={row.enabled ? 'default' : 'secondary'}>
          {row.enabled ? 'Enabled' : 'Disabled'}
        </Badge>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="hit-area"
                disabled={pending}
                onClick={() => {
                  run(() => duplicateEmbedAction(eventId, row.id))
                }}
              />
            }
          >
            <CopyIcon />
            <span className="sr-only">Duplicate</span>
          </TooltipTrigger>
          <TooltipContent>Duplicate</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" className="hit-area" disabled={pending} />}
          >
            <MoreHorizontalIcon />
            <span className="sr-only">Options</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem nativeButton={false} render={<Link href={editHref} />}>
              <PencilIcon />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                run(() => setEmbedEnabledAction(eventId, row.id, !row.enabled))
              }}
            >
              <PowerIcon />
              {row.enabled ? 'Disable' : 'Enable'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                setConfirming(true)
              }}
            >
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardContent>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this embed?</AlertDialogTitle>
            <AlertDialogDescription>
              {row.name} stops being served immediately. If its code is on a website, that page will
              show nothing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                run(() => deleteEmbedAction(eventId, row.id))
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
