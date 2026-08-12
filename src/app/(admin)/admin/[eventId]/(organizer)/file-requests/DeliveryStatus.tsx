'use client'

// Who has delivered a requested document and who has not. CNT-07 and CNT-08.
//
// TWO VIEWS OF ONE SET, and the default is the pair. `By deliverable` is one row per (speaker,
// requested document) with that document's own status and its own due date, which is the thing
// the criterion asks for and the thing the old aggregate could not express: a speaker owing
// three documents has three deadlines and one row has room for none of them. `By speaker` is
// the roll-up that was here before, kept because it answers a different question (how is the
// roster doing) and because it is the only view that lists a speaker of whom nothing has been
// requested at all.
//
// The two are wired together rather than parallel: the roll-up's Missing cell opens the pair
// table pinned to that one speaker, which is what its truncated `and N more` used to imply and
// not deliver.
//
// The reminder lives on the header, next to the counts that say who is behind. Chasing a
// deliverable used to be possible only from the Tasks page, which reminds people about
// onboarding to-dos, so a late release form had no control anywhere on the surface that owns it.
//
// The poller is imported from the Tasks route rather than copied. BUILD_SPEC 5.6 allows exactly
// one polling component in the app, and this is a second surface with the same freshness
// requirement: a speaker uploads in the portal, and an admin already looking at this table has
// to see it move without reloading.

import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { DeliveryRow } from '@/features/file-requests/delivery'
import type { DeliverableRow } from '@/features/files/deliverables'
import { outstandingDeliverableRows } from '@/features/files/outstanding-deliverables'
import { ProgressPoller } from '../tasks/ProgressPoller'
import { DeliverablesTable } from './DeliverablesTable'
import { RemindDeliverablesButton } from './RemindDeliverablesButton'
import { SpeakerDeliveryTable } from './SpeakerDeliveryTable'

type DeliveryView = 'deliverables' | 'speakers'

export function DeliveryStatus({
  eventId,
  speakers,
  deliverables,
  totals,
  canEdit,
}: {
  eventId: string
  speakers: readonly DeliveryRow[]
  deliverables: readonly DeliverableRow[]
  totals: { speakers: number; requested: number; received: number; complete: number }
  /** False for a reviewer, who may read this board and may not mail the roster. */
  canEdit: boolean
}) {
  const [view, setView] = useState<DeliveryView>('deliverables')
  const [focus, setFocus] = useState<{ id: string; name: string } | null>(null)

  // Who the reminder would address, computed from the same rows the table renders, so the
  // count on the button is the count on the screen. The action recomputes it server-side
  // regardless: this is what the control says, not what decides the recipients.
  const behind = useMemo(() => outstandingDeliverableRows(deliverables), [deliverables])
  const outstandingFiles = behind.reduce((total, row) => total + row.deliverables.length, 0)

  return (
    <section className="flex min-w-0 flex-col gap-3">
      {/* Only while a document is still outstanding. See the note on the onboarding table: a
          collected roster was polling forever and the page never settled. */}
      <ProgressPoller enabled={totals.received < totals.requested} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">Delivery status</h2>
          <p className="text-sm text-muted-foreground">
            {totals.speakers} accepted {totals.speakers === 1 ? 'speaker' : 'speakers'},{' '}
            {totals.received} of {totals.requested} files received, {totals.complete} fully
            delivered
          </p>
        </div>
        <RemindDeliverablesButton
          eventId={eventId}
          speakerIds={behind.map((row) => row.speakerId)}
          files={outstandingFiles}
          disabled={!canEdit}
        />
      </div>

      <Tabs
        value={view}
        onValueChange={(next: string) => {
          setView(next as DeliveryView)
          if (next === 'speakers') setFocus(null)
        }}
      >
        <TabsList variant="line" className="group-data-horizontal/tabs:h-auto min-h-8 flex-wrap">
          <TabsTrigger value="deliverables">
            By deliverable
            <Badge variant="secondary">{deliverables.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="speakers">
            By speaker
            <Badge variant="secondary">{speakers.length}</Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {view === 'deliverables' ? (
        <DeliverablesTable rows={deliverables} focus={focus} onClearFocus={() => setFocus(null)} />
      ) : (
        <SpeakerDeliveryTable
          rows={speakers}
          onDrillDown={(row) => {
            setFocus({ id: row.speakerId, name: row.name })
            setView('deliverables')
          }}
        />
      )}
    </section>
  )
}
