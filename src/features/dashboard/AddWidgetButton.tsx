'use client'

// Ref 38's `+ Add Widget`, and the Add Widget modal it opens.
//
// **There is no mode tab strip here any more.** Ref 40's three tabs (`Gallery` / `AI prompt` /
// `Build manually`) were reused on this modal, and on this modal two of the three were dead: both
// non-gallery panes rendered a line saying the mode is not built, and neither tab was disabled, so
// the only way to learn that was to click. One pane with contents does not need a strip to select
// it, so the gallery is now the modal's whole body. dashboard-modes.ts still records the label
// divergence from the current product, and the strip survives on the New Dashboard modal, where
// two of its panes are real.
//
// **The gallery's contents are ours.** docs/parity/external-references.md lists the Add
// Widget gallery under "Still uncaptured", so nothing here is transcribed except the eight widget
// titles, which come off refs 38 and 39. A widget is one of eight fixed metrics in this build, so
// the pane is those eight with the shape each one draws, and there is no report picker because
// there are no reports.
//
// After a successful insert: ref 38's `Widget added` toast, then `router.refresh()`. The refresh
// is what re-renders the grid; the write already expired `event:{id}:dashboard-widgets`, so the
// rerender reads the new row rather than the cached list.

import { PlusIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { addWidgetAction } from '@/features/dashboard/actions'
import { WIDGET_CATALOG } from '@/features/dashboard/widget-catalog'

/** Authored: the modal's subtitle is not captured, and a dialog needs its description. */
const SUBTITLE = 'Pick a widget to add to this dashboard.'

export function AddWidgetButton({
  eventId,
  dashboardId,
  present,
}: {
  eventId: string
  dashboardId: string
  /**
   * The metrics already on this dashboard. One card per metric, so these are shown as added
   * rather than offered: the action refuses a duplicate, and a gallery card that is going to
   * be refused is exactly the control this build spent a pass removing.
   */
  present: readonly string[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const add = (metric: string) => {
    startTransition(async () => {
      const result = await addWidgetAction(eventId, dashboardId, metric)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setOpen(false)
      toast.success(result.message)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" className="hit-area-y" />}>
        {/* `data-icon="inline-start"` trips the Button's own optical padding
            (`has-data-[icon=inline-start]:pl-1.5` against a base `px-2.5`), so the leading
            icon sits closer to the edge than the trailing text and the label reads centred. */}
        <PlusIcon data-icon="inline-start" />
        Add Widget
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] gap-4 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Widget</DialogTitle>
          <DialogDescription>{SUBTITLE}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-2">
          {WIDGET_CATALOG.map((spec) => {
            const added = present.includes(spec.metric)
            return (
              <Button
                key={spec.metric}
                variant="outline"
                disabled={pending || added}
                onClick={() => {
                  add(spec.metric)
                }}
                // `plain-label`: a gallery card is not a command label. Its body is a widget
                // title and a sentence of prose, and the machine-label treatment set the whole
                // card in 11px mono uppercase, so the summary read as shouted. The title keeps
                // its own `uppercase` below, which is how refs 38 and 39 present a widget name.
                className="plain-label h-auto flex-col items-stretch gap-1.5 whitespace-normal p-3 text-left"
              >
                <span className="text-xs font-medium tracking-wide uppercase">{spec.title}</span>
                <span className="text-xs font-normal text-pretty text-muted-foreground">
                  {spec.summary}
                </span>
                <span className="flex">
                  <Badge variant="secondary">{added ? 'On this dashboard' : spec.widgetType}</Badge>
                </span>
              </Button>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
