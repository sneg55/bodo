'use client'

// The cross-event directory's entry into the bulk composer. CRM-11.
//
// Its own shell rather than a flag on `BulkEmailButton`, because everything it adds is a
// question the roster does not have: which event to send under, whether the viewer can send
// from any event at all, and how much of a cross-event selection that choice excludes. The
// composer inside is the SAME component the roster opens, which is the point: one editor, one
// preview, one send path, one Email history row.
//
// The event choice is not cosmetic. `bulk-crm-actions.ts` carries the argument in full, and
// the short version is that scoping a send to one event is the only scoping under which
// `{{event.name}}` is true for every recipient. This shell owns that choice and the running
// resolution behind it; the composer owns the draft and knows nothing about either.
//
// It renders NOTHING until a row is ticked, matching `MergeSpeakersButton` beside it in the
// same toolbar, and it disappears again when the selection is cleared.

import { MailPlusIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { BulkEmailComposer } from '@/features/comms/BulkEmailComposer'
import { BulkEmailScope } from '@/features/comms/BulkEmailScope'
import {
  type CrmRecipientScope,
  type CrmSendEvent,
  loadCrmSendEventsAction,
  resolveCrmRecipientsAction,
} from '@/features/comms/bulk-crm-actions'

export function CrmBulkEmailButton({
  speakerIds,
  onSent,
}: {
  /** The ticked rows, resolved by the directory against what the server sent. */
  speakerIds: readonly string[]
  onSent: () => void
}) {
  const [open, setOpen] = useState(false)
  const count = speakerIds.length

  if (count === 0) return null

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline">
            <MailPlusIcon data-icon="inline-start" />
            {`Compose email (${String(count)})`}
          </Button>
        }
      />
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl!">
        {/* Mounted fresh each time the drawer opens, so last send's subject, body and event
            are gone rather than waiting to be sent to a different selection by accident. */}
        {open ? (
          <CrmComposerBody
            speakerIds={speakerIds}
            onSent={() => {
              setOpen(false)
              onSent()
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function CrmComposerBody({
  speakerIds,
  onSent,
}: {
  speakerIds: readonly string[]
  onSent: () => void
}) {
  const [events, setEvents] = useState<readonly CrmSendEvent[] | undefined>(undefined)
  const [eventId, setEventId] = useState('')
  // Stored WITH the event it was computed for, and matched against the current one at render
  // time. Clearing it inside the effect would be a synchronous setState in an effect body
  // (which the lint rule refuses) and it would also be weaker: a resolution that arrives
  // after the organizer has moved on could still land under the wrong event's name. Tagging
  // makes staleness unrepresentable rather than merely unlikely.
  const [resolved, setResolved] = useState<
    { eventId: string; scope: CrmRecipientScope } | undefined
  >(undefined)

  // The events this viewer holds `admin` on. Loaded here rather than in the directory's
  // payload: it is only needed by somebody who has opened this drawer, and the directory is
  // a table of hundreds of rows that should not carry a membership read for most visits.
  useEffect(() => {
    let live = true
    void loadCrmSendEventsAction().then((result) => {
      if (!live || !result.ok) return
      setEvents(result.events)
      // Defaulted to the first rather than left unpicked. An unpicked event makes every
      // control below it meaningless, and the scope line states the choice loudly enough
      // that a default cannot be mistaken for a decision the organizer made.
      setEventId((current) => (current === '' ? (result.events.at(0)?.id ?? '') : current))
    })
    return () => {
      live = false
    }
  }, [])

  // The selection as a stable VALUE, and the effect reads its ids back out of it.
  //
  // `speakerIds` arrives from `selectedRows.map(...)`, so it is a new array on every render of
  // the directory even when the same rows are ticked. Depending on the array itself would fire
  // this resolution once per keystroke in the directory's search box while the drawer is open,
  // which is a server action per character. Reading the ids out of the key rather than closing
  // over the prop is what keeps that honest: there is no second source that could go stale.
  const selectionKey = speakerIds.join(',')

  // Re-runs when the event changes, which is what keeps the exclusion line honest: it is the
  // answer for the event now chosen, not the one chosen when the drawer opened.
  useEffect(() => {
    if (eventId === '') return
    const ids = selectionKey === '' ? [] : selectionKey.split(',')
    let live = true
    void resolveCrmRecipientsAction({ eventId, speakerIds: ids }).then((result) => {
      if (!live || !result.ok) return
      setResolved({
        eventId,
        scope: {
          recipients: result.recipients,
          notOnEvent: result.notOnEvent,
          skippedNoEmail: result.skippedNoEmail,
          skippedDuplicate: result.skippedDuplicate,
        },
      })
    })
    return () => {
      live = false
    }
  }, [eventId, selectionKey])

  // `undefined` while a resolution for THIS event is still in flight, which is what makes
  // the scope line read as pending and holds the Send button disabled. A stale answer for
  // the previously chosen event can never be shown, because it cannot match.
  const scope = resolved?.eventId === eventId ? resolved.scope : undefined

  if (events !== undefined && events.length === 0) {
    // Not a disabled button an organizer cannot explain: they hold `reviewer` everywhere, so
    // there is no event they could send from and the drawer says which capability is missing.
    return (
      <p className="p-6 text-sm text-pretty text-muted-foreground">
        You need the admin role on an event to send email from it. Your memberships are all
        reviewer.
      </p>
    )
  }

  return (
    <BulkEmailComposer
      // Remounted per event, so a draft is never carried between two conferences' templates
      // and merge contexts without the organizer noticing.
      key={eventId}
      eventId={eventId}
      speakerIds={speakerIds}
      onSent={onSent}
      recipientCount={scope?.recipients}
      scope={
        <BulkEmailScope
          events={events ?? []}
          eventId={eventId}
          onEventChange={setEventId}
          selected={speakerIds.length}
          scope={scope}
        />
      }
    />
  )
}
