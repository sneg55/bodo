'use client'

// The composer's event picker, and the sentence that says who picking it excludes. CRM-11.
//
// Rendered only on the CROSS-EVENT path. From the speakers roster there is exactly one event
// and it is in the URL, so a picker there would be a control with one option; from the CRM
// directory the selection can span conferences and the event is a genuine choice the
// organizer has to make before anything else on the drawer means anything.
//
// THE EXCLUSION LINE IS THE POINT OF THIS FILE, not the dropdown. A send is scoped to one
// event because that is the only scoping under which `{{event.name}}` can be true for every
// recipient (bulk-crm-actions.ts carries the full argument), and the cost of that decision is
// that some of the ticked people are not on the chosen event. That cost has to be visible
// BEFORE the send rather than inferable from a count afterwards, which is why it is a
// sentence under the picker and refreshes the moment the event changes.
//
// It says `n of m selected`, always, rather than only speaking up when somebody is excluded.
// A control that is silent when everything is fine and shouts when it is not teaches the
// organizer to read silence as "no answer yet", and this line renders while a resolution is
// still in flight.

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { CrmRecipientScope, CrmSendEvent } from '@/features/comms/bulk-crm-actions'

/**
 * The one sentence, assembled from the resolution.
 *
 * Exported and pure so the wording is asserted directly (tests/comms-bulk-crm-scope.test.ts)
 * rather than through a rendered drawer: getting "12 of 15" backwards is the kind of defect
 * that reads fine in a component and misinforms every send.
 */
export function scopeSummary(input: {
  selected: number
  scope: CrmRecipientScope | undefined
  eventName: string | undefined
}): string {
  if (input.scope === undefined || input.eventName === undefined) {
    return `Checking which of the ${String(input.selected)} selected are on this event...`
  }

  const head = `${String(input.scope.recipients)} of ${String(input.selected)} selected will be emailed under ${input.eventName}.`

  // Each exclusion is named with its CAUSE, because the three have different fixes: pick a
  // different event, add an address, or nothing at all.
  const tail = [
    input.scope.notOnEvent === 0
      ? undefined
      : `${String(input.scope.notOnEvent)} are not on this event and will not be emailed.`,
    input.scope.skippedNoEmail === 0
      ? undefined
      : `${String(input.scope.skippedNoEmail)} have no email address on file.`,
    input.scope.skippedDuplicate === 0
      ? undefined
      : `${String(input.scope.skippedDuplicate)} share an address with somebody already counted.`,
  ].filter((part) => part !== undefined)

  return [head, ...tail].join(' ')
}

export function BulkEmailScope({
  events,
  eventId,
  onEventChange,
  selected,
  scope,
}: {
  events: readonly CrmSendEvent[]
  eventId: string
  onEventChange: (next: string) => void
  /** How many rows the organizer ticked, before any resolution narrows it. */
  selected: number
  /** Undefined while the resolution is in flight. */
  scope: CrmRecipientScope | undefined
}) {
  const eventName = events.find((event) => event.id === eventId)?.name
  const excluded = scope !== undefined && scope.notOnEvent > 0

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="bulk-email-event">Send under</Label>
      <Select
        value={eventId === '' ? null : eventId}
        items={events.map((event) => ({ value: event.id, label: event.name }))}
        onValueChange={(next: string | null) => {
          if (next !== null) onEventChange(next)
        }}
      >
        <SelectTrigger id="bulk-email-event" className="w-full">
          <SelectValue placeholder="Pick an event" />
        </SelectTrigger>
        <SelectContent>
          {events.map((event) => (
            <SelectItem key={event.id} value={event.id}>
              {event.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* `tabular-nums`: every number in this sentence is recomputed when the event changes,
          and it is the one line an organizer re-reads to check the send. Proportional digits
          make "12 of 15" and "9 of 15" set to different widths, so the words behind them
          shuffle on each swap. */}
      <p
        className={
          excluded
            ? 'text-xs text-pretty text-destructive tabular-nums'
            : 'text-xs text-pretty text-muted-foreground tabular-nums'
        }
      >
        {scopeSummary({ selected, scope, eventName })}
      </p>
      <p className="text-xs text-pretty text-muted-foreground">
        The message is sent under one event, so {'{{event.name}}'} names an event every recipient
        belongs to, and the send is logged in that event&rsquo;s Email history.
      </p>
    </div>
  )
}
