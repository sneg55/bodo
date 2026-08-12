'use client'

// The admin resource list's rows: one card per page, with the two controls that mutate.
//
// A client component because the publish switch and the delete confirmation are
// interactive; the rows themselves arrive as plain serializable data from the server page,
// so nothing about a Resource record beyond what is displayed crosses the boundary. The
// embed markup deliberately does NOT: the list only needs to know whether there is one.
//
// Both actions are optimistic in appearance only for the switch, which flips immediately
// and is reconciled by the action's result; a failed toggle puts it back and raises the
// error toast, rather than leaving the UI claiming a state the server refused.

import { EyeIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { deleteResourceAction, setResourcePublishedAction } from '@/features/resources/actions'
import { DeleteResourceDialog } from '@/features/resources/DeleteResourceDialog'

export type ResourceRow = {
  id: string
  title: string
  slug: string
  visibility: 'portal' | 'public'
  order: number
  enabled: boolean
  hasEmbed: boolean
}

export function ResourceRows({ eventId, rows }: { eventId: string; rows: readonly ResourceRow[] }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <Row key={row.id} eventId={eventId} row={row} />
      ))}
    </div>
  )
}

function Row({ eventId, row }: { eventId: string; row: ResourceRow }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [enabled, setEnabled] = useState(row.enabled)
  const [confirming, setConfirming] = useState(false)
  const editHref = `/admin/${eventId}/resources/${row.id}`

  function togglePublished(next: boolean) {
    setEnabled(next)
    startTransition(async () => {
      const result = await setResourcePublishedAction(eventId, row.id, next)
      if (result.ok) {
        toast.success('Saved successfully', { description: result.message })
        router.refresh()
      } else {
        setEnabled(!next)
        toast.error(result.message)
      }
    })
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteResourceAction(eventId, row.id)
      setConfirming(false)
      if (result.ok) {
        toast.success('Saved successfully', { description: result.message })
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={editHref} className="truncate font-medium hover:underline">
              {row.title}
            </Link>
            <Badge variant={enabled ? 'default' : 'secondary'}>
              {enabled ? 'Enabled' : 'Disabled'}
            </Badge>
            {row.hasEmbed ? <Badge variant="outline">Embed</Badge> : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            /portal/resources/{row.slug} &middot; {row.visibility} &middot; order {row.order}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor={`published-${row.id}`} className="text-xs text-muted-foreground">
            Enabled
          </Label>
          <Switch
            id={`published-${row.id}`}
            checked={enabled}
            disabled={pending}
            onCheckedChange={togglePublished}
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              // `hit-area-y` and not `hit-area`: the Switch 12px to the left carries its own
              // `after:-inset-x-3`, so its target already ends exactly at this button's edge
              // and a centred 40px box would cross it by 4px.
              <Button
                variant="ghost"
                size="icon"
                className="hit-area-y"
                aria-label={`Options for ${row.title}`}
              >
                <MoreHorizontalIcon />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem render={<Link href={editHref} />}>
              <PencilIcon />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              render={<Link href={`/portal/resources/${row.slug}`} target="_blank" />}
            >
              <EyeIcon />
              View in portal
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DeleteResourceDialog
          title={row.title}
          open={confirming}
          pending={pending}
          onOpenChange={setConfirming}
          onConfirm={remove}
        />
      </CardContent>
    </Card>
  )
}
