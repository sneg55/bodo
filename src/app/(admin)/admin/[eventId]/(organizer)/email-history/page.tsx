// /admin/[eventId]/email-history
//
// The path matches the sidebar's label, which it did not: this was `/comms` under an "Email
// history" nav entry, so the one URL a person would guess from the label answered 404.
//
// The event's email history. `EmailOutbox` has held every one of these rows since the comms
// path shipped and nothing surfaced them, so the only way to answer "did the acceptance
// email actually go out" was to open Airtable. Three rubric items turned on that question
// and two of them could only ever be checked by hand.
//
// Read-only, deliberately. The drain owns every transition an outbox row makes, so a
// Resend button here would be a second writer racing the cron for the same row, and the
// idempotency key exists precisely to make "send it again" a decision rather than a click.

import { MailIcon } from 'lucide-react'
import { buildEmailLog } from '@/features/comms/log'
import { requireEventId } from '@/features/events/resolve-ref'
import { getEvent } from '@/services/airtable/queries'
import { listOutboxForEvent } from '@/services/airtable/reads-portal'

import { EmailLogTable } from './EmailLogTable'

export default async function CommsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)
  const [event, rows] = await Promise.all([getEvent(eventId), listOutboxForEvent(eventId)])
  const view = buildEmailLog(rows, event.timezone)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <MailIcon className="mt-0.5 size-5 text-muted-foreground" />
        <div>
          <h1 className="font-heading text-lg font-medium">Email history</h1>
          <p className="text-sm text-muted-foreground">
            Every message this event has queued, with what happened to it.
          </p>
        </div>
      </div>

      <EmailLogTable view={view} />
    </div>
  )
}
