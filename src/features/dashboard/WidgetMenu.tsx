'use client'

// The overflow menu on a widget card: Move up, Move down, Remove.
//
// **Not captured anywhere.** Refs 38 and 39 show widget cards with no controls at all, and the
// parity doc's Ambiguities list has never known what the reference offers per widget. What is
// certain is that this build offered nothing: once a widget was added, the only way to be rid of
// it was Settings > Delete dashboard, which takes the tab and every other widget with it. So
// this is authored, and it is authored as the smallest thing that closes that trap.
//
// `DropdownMenu` per .claude/rules/ui-shadcn.md, which is also what every other overflow in this
// build uses (ResourceRows, TasksPanel), so the affordance is the same one an organizer has
// already met elsewhere.
//
// **No confirmation on Remove, and that is a decision rather than an omission.** This build
// reserves `AlertDialog` for a write that destroys something a person authored or breaks a URL
// somebody else holds: deleting a resource page 404s a link speakers have, and deleting a
// dashboard takes a tab and every widget on it. A widget is neither. Its title and shape come
// from the closed catalogue, its metric is one of eight, and its numbers are recomputed from
// Airtable on every read, so removing one destroys a POSITION IN A GRID and nothing else, and
// `+ Add Widget` puts it back in two clicks from the same screen. A modal in front of that is
// friction charged on every use to insure against a mis-click that costs two clicks. The
// mis-click is guarded the way the design system guards it instead: the item is behind an
// overflow, below a separator, in the destructive variant. The toast names the way back.
//
// **Reordering moves by naming a neighbour, not by naming a position.** The card is told which
// widget is above and below it on screen and posts that id; `swapWidgetOrder` explains why a
// position computed on the server would be over the wrong list. A card at either end has no
// neighbour on that side and its item is disabled rather than posting a move that cannot happen.
//
// Every write goes back through `router.refresh()`, which is what makes the grid correct rather
// than optimistic: the action already expired `event:{id}:dashboard-widgets`, so the rerender
// reads the rows as they now are. Nothing here holds a copy of the order in client state, so
// there is no second version of the grid to drift.

import { ArrowDownIcon, ArrowUpIcon, MoreHorizontalIcon, Trash2Icon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { DashboardActionResult } from '@/features/dashboard/action-result'
import { moveWidgetAction, removeWidgetAction } from '@/features/dashboard/actions'

/** Shown under the `Widget removed` toast, since there is no undo to offer. */
const REMOVED_HINT = 'Add it again from + Add Widget.'

export function WidgetMenu({
  eventId,
  dashboardId,
  widgetId,
  title,
  previousId,
  nextId,
}: {
  eventId: string
  dashboardId: string
  widgetId: string
  /** For the trigger's accessible name, so a grid of them is not six identical buttons. */
  title: string
  /** The widget rendered above this one, absent on the first card. */
  previousId?: string
  /** The widget rendered below this one, absent on the last card. */
  nextId?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const run = (write: () => Promise<DashboardActionResult>, description?: string) => {
    startTransition(async () => {
      const result = await write()
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message, description === undefined ? undefined : { description })
      router.refresh()
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            // The only control on a widget card, and the nearest other one is the next
            // card's copy of it, a card width away across the grid's `gap-3`. So the 28px
            // square gets the full 40px area: it reaches 6px past each edge, which still
            // stops 6px inside the card's own padding box.
            className="hit-area -mt-1 -mr-1 size-7"
            disabled={pending}
            aria-label={`Options for ${title}`}
          >
            <MoreHorizontalIcon />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={previousId === undefined}
          onClick={() => {
            if (previousId !== undefined) {
              run(() => moveWidgetAction(eventId, dashboardId, widgetId, previousId))
            }
          }}
        >
          <ArrowUpIcon />
          Move up
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={nextId === undefined}
          onClick={() => {
            if (nextId !== undefined) {
              run(() => moveWidgetAction(eventId, dashboardId, widgetId, nextId))
            }
          }}
        >
          <ArrowDownIcon />
          Move down
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            run(() => removeWidgetAction(eventId, dashboardId, widgetId), REMOVED_HINT)
          }}
        >
          <Trash2Icon />
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
