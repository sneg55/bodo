// Event Settings > Event Details.
//
// The timezone option list is built HERE, on the server, and handed down as plain
// `{ value, label }` pairs. Two reasons: `Intl.supportedValuesOf('timeZone')` returns
// several hundred ids and formatting each one costs an `Intl.DateTimeFormat` construction,
// which is work the browser should not repeat; and the offsets then come from one runtime
// rather than from whatever the visitor's browser thinks, so a label cannot disagree with
// the times the agenda renders server side.
//
// One file, not a shell plus a body child: `loading.tsx` in the parent segment is the
// boundary, and the only read here is the event record.

import { requireEventId } from '@/features/events/resolve-ref'
import { isSettingsOrganizer } from '@/features/settings/authorize'
import { draftFromEvent } from '@/features/settings/draft'
import { EventDetailsForm } from '@/features/settings/EventDetailsForm'
import { timezoneOptions } from '@/features/settings/timezones'
import { getEvent } from '@/services/airtable/queries'

export const metadata = { title: 'Event Details' }

export default async function EventDetailsPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)
  // The admin layout redirects an unauthorized browser. This is not the security boundary:
  // `saveEventDetailsAction` calls `requireEventRole` for itself. BUILD_SPEC 4.
  if (!(await isSettingsOrganizer(eventId))) return null

  const event = await getEvent(eventId)

  return (
    <EventDetailsForm
      eventId={eventId}
      initial={draftFromEvent(event)}
      timezones={timezoneOptions()}
    />
  )
}
