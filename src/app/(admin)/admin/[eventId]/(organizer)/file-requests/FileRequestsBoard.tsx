'use client'

// Ref 30's File Requests list, then the delivery table underneath it.
//
// Search, tabs and selection are local state. There is no server-side filtering to drive: an
// event's request list is a handful of rows and the whole set is already in this page's
// payload, so a URL query string would cost a round trip to filter what the browser holds.
//
// The search input is an ADDITION. Ref 30 captured this list empty and its inventory names
// only the header, `+ Add`, the tabs and the empty state, while ref 25's sibling list carries
// `Search tasks...`; the two surfaces are one pattern per BUILD_SPEC 5.6, so the box is
// borrowed from the sibling rather than invented, and it filters for real.
//
// Assigning is a bulk action, because collecting a release form from the whole accepted cast
// is the thing an organizer actually does. The kebab on a card assigns that one request.
//
// EXPORT is the other half of that same job and sits beside it: having chased a release form
// out of forty speakers, the next thing an organizer wants is all forty in one zip. A ticked
// request is an OBLIGATION rather than a file, so the dialog resolves it and says plainly
// which of the ticked rows nobody has answered (features/bundle/request-selection). It is
// enabled without `canEdit`, unlike Assign: exporting reads what has already arrived, and the
// action behind it authorizes `reviewer` for itself.

import { DownloadIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FileBundleDialog } from '@/features/bundle/FileBundleDialog'
import { assignFileRequestsAction } from '@/features/file-requests/actions'
import type { FileRequestsAdminView } from '@/features/file-requests/admin-view'
import { filterRequestCards, type RequestTab } from '@/features/file-requests/cards'
import type { DeliverableRow } from '@/features/files/deliverables'

import { AddFileRequestButton } from './AddFileRequestButton'
import { DeliveryStatus } from './DeliveryStatus'
import { RequestCard } from './RequestCard'

export function FileRequestsBoard({
  eventId,
  view,
  deliverables,
  canEdit,
}: {
  eventId: string
  view: FileRequestsAdminView
  /** One row per (speaker, requested document), for the Delivery status table. See CNT-07. */
  deliverables: readonly DeliverableRow[]
  /** A reviewer can read this surface. Both writes require `admin` regardless. */
  canEdit: boolean
}) {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<RequestTab>('all')
  const [selected, setSelected] = useState<readonly string[]>([])
  const [exportOpen, setExportOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  // Memoized because the dialog reads on a `source` effect. An inline object literal would be
  // a fresh identity on every render, the effect would refire, its `setState` would render
  // again, and the dialog would read in a loop for as long as it stayed open.
  const exportSource = useMemo(
    () => ({ kind: 'requests' as const, fileRequestIds: selected }),
    [selected],
  )

  const visible = filterRequestCards(view.cards, tab, search)

  const assign = (fileRequestIds: readonly string[]) => {
    startTransition(async () => {
      const result = await assignFileRequestsAction({ eventId, fileRequestIds })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setSelected([])
      // The card's own "0/4 received" line is the LASTING report of what just happened, and
      // it comes from the server. Without this the counts stayed at "Not requested from
      // anybody yet" until a full page load, so once the toast faded there was nothing on
      // screen saying the press had done anything at all. The action already expired the
      // tags server-side; this is what gets this browser to ask again.
      router.refresh()
      toast.success(
        result.created === 0
          ? 'Already assigned'
          : `Requested ${result.created} ${result.created === 1 ? 'file' : 'files'} from ${result.speakers} ${result.speakers === 1 ? 'speaker' : 'speakers'}`,
        {
          description:
            result.skipped === 0
              ? undefined
              : `${result.skipped} already had a row and were left alone.`,
        },
      )
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Input
            value={search}
            placeholder="Search file requests..."
            className="max-w-sm"
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="flex items-center gap-2">
            {selected.length === 0 ? null : (
              <>
                <Button
                  variant="outline"
                  disabled={!canEdit || pending}
                  onClick={() => assign(selected)}
                >
                  Assign {selected.length} to {view.acceptedSpeakers} accepted{' '}
                  {view.acceptedSpeakers === 1 ? 'speaker' : 'speakers'}
                </Button>
                <Button variant="outline" onClick={() => setExportOpen(true)}>
                  <DownloadIcon />
                  Export {selected.length}
                </Button>
              </>
            )}
            {/* Mounted only while open, so each opening starts from a fresh read with nothing
                deselected. See the note at the top of FileBundleDialog. */}
            {exportOpen ? (
              <FileBundleDialog
                eventId={eventId}
                source={exportSource}
                onOpenChange={setExportOpen}
              />
            ) : null}
            <AddFileRequestButton
              eventId={eventId}
              acceptedSpeakers={view.acceptedSpeakers}
              disabled={!canEdit}
            />
          </div>
        </div>

        <Tabs value={tab} onValueChange={(next: string) => setTab(next as RequestTab)}>
          <TabsList variant="line" className="group-data-horizontal/tabs:h-auto min-h-8 flex-wrap">
            {view.tabs.map((entry) => (
              <TabsTrigger key={entry.id} value={entry.id}>
                {entry.label}
                <Badge variant="secondary">{entry.count}</Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            {/* Verbatim off ref 30's empty state. */}
            <p className="font-medium">No file requests yet</p>
            <p className="text-sm text-muted-foreground">
              Create a file request to collect documents from participants
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((card) => (
              <RequestCard
                key={card.id}
                card={card}
                selected={selected.includes(card.id)}
                disabled={!canEdit || pending}
                onSelectedChange={(next) =>
                  setSelected((current) =>
                    next ? [...current, card.id] : current.filter((id) => id !== card.id),
                  )
                }
                onAssign={() => assign([card.id])}
              />
            ))}
          </div>
        )}
      </div>

      <DeliveryStatus
        eventId={eventId}
        speakers={view.delivery}
        deliverables={deliverables}
        totals={view.totals}
        canEdit={canEdit}
      />
    </div>
  )
}
