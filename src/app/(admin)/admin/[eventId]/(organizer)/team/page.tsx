// /admin/[eventId]/team
//
// The one management surface for `EventMemberships`. BUILD_SPEC 5.0b: "Event Team is real, not
// a placeholder", because the walkthrough says plainly "you should be able to enter in admins",
// and both the notification recipient pickers and committee assignment need a set of people to
// pick from.
//
// PRESENTATION IS AUTHORED, NOT TRANSCRIBED: no screenshot of this surface exists, so there is
// no parity checklist for it. The header follows the captured admin lists (icon tile, title,
// subtitle) and the columns are BUILD_SPEC's own list. See ./TeamPanel.tsx.
//
// One file, not a shell plus a body child inside `<Suspense>`: `loading.tsx` is the boundary,
// and there is no fast half to paint ahead of a two-call read.

import { UserCogIcon } from 'lucide-react'
import { PageHeader } from '@/components/primitives/PageHeader'
import { requireEventId } from '@/features/events/resolve-ref'
import { isTeamOrganizer } from '@/features/team/authorize'
import { readTeamMembers } from '@/features/team/reads'
import { TeamPanel } from '@/features/team/TeamPanel'

export const metadata = { title: 'Event Team' }

export default async function EventTeamPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)

  // The layout redirects a stranger and this is not the security boundary: every write calls
  // `requireEventRole(eventId, 'admin')` for itself, because a Server Action is reachable by
  // POST without this page ever rendering. BUILD_SPEC 4. A reviewer gets nothing here, which is
  // deliberate: the content of this page is who holds which role.
  if (!(await isTeamOrganizer(eventId))) return null

  const members = await readTeamMembers(eventId)

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        icon={UserCogIcon}
        title="Event Team"
        description="Give people access to this event as an admin or a reviewer"
      />

      <TeamPanel eventId={eventId} members={members} />
    </div>
  )
}
