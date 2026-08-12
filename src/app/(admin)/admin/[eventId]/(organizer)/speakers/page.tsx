// /admin/[eventId]/speakers
//
// The organizer's roster of everyone on the event, and the surface CNT-10 asks for: editing a
// speaker's bio and headshot centrally rather than waiting for them to do it themselves.
//
// PRESENTATION IS AUTHORED, NOT TRANSCRIBED: no screenshot of this surface exists, so there
// is no parity checklist for it. See the header of `SpeakerRosterPanel`.
//
// One file, not a shell plus a body child inside `<Suspense>`. `loading.tsx` beside this is
// the boundary, and there is no fast half worth painting ahead of a two-call read.

import { UsersIcon } from 'lucide-react'
import { PageHeader } from '@/components/primitives/PageHeader'
import { requireEventId } from '@/features/events/resolve-ref'
import { loadSpeakerRoster } from '@/features/speakers/admin-roster'
import { SpeakerRosterPanel } from '@/features/speakers/SpeakerRosterPanel'

export const metadata = { title: 'Speakers' }

export default async function SpeakersPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)
  const { speakers } = await loadSpeakerRoster(eventId)

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        icon={UsersIcon}
        title="Speakers"
        description="Everyone on this event, including the ones whose submissions are still pending"
      />

      <SpeakerRosterPanel eventId={eventId} speakers={speakers} />
    </div>
  )
}
