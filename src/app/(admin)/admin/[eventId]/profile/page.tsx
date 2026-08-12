// /admin/[eventId]/profile
//
// The account page behind the avatar menu. It closes a gap that was invisible because the
// control for it already existed: `AdminTopBar` has always rendered a `Profile` item, gated
// on a `profileHref` prop that no caller ever passed, so the item never appeared and the
// `AdminUsers.Name` column was write-once-and-never. Every invited member's row is created
// with an address and nothing else, which is why the team table is full of "No name yet" and
// why the avatar menu shows an email where a name belongs.
//
// OUTSIDE the `(organizer)` route group, alongside `evaluation/`, and that placement is the
// point rather than an accident: the parent layout admits any membership, `(organizer)`
// narrows to admins, and the people whose rows have no name are mostly invited REVIEWERS. A
// page about your own name that a reviewer could not open would miss its main audience.
//
// Nothing here is the security boundary. `saveProfileNameAction` takes no ids at all and
// writes only the row the session resolves to. BUILD_SPEC 4.

import { UserIcon } from 'lucide-react'
import { PageHeader } from '@/components/primitives/PageHeader'
import { requireAdminUser } from '@/features/auth/wiring'
import { requireEventId } from '@/features/events/resolve-ref'
import { ProfileForm } from '@/features/team/ProfileForm'
import { readTeamMembers } from '@/features/team/reads'

export const metadata = { title: 'Your Profile' }

export default async function ProfilePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)
  const { userId } = await requireAdminUser()

  // The CACHED team read, which is the same pair `actingUser` issues for the avatar in the
  // header of this very page, so it is a cache hit rather than a second round trip. A
  // dedicated AdminUsers-by-id read would be a third cache entry for one row.
  const member = (await readTeamMembers(eventId)).find((row) => row.userId === userId)

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        icon={UserIcon}
        title="Your Profile"
        description="How you appear to the rest of this event's team"
      />

      {/* Blank rather than a 404 when the row is not on this event's list. The layout has
          already established a membership, so this is a cache skew between two reads and not
          a stranger; it resolves on the next revalidation, and `notFound()` here would
          answer HTTP 200 with the 404 body anyway, because `loading.tsx` next to this file
          is a Suspense boundary (.claude/rules/bodo-conventions.md). */}
      <ProfileForm initialName={member?.name ?? ''} email={member?.email ?? ''} />
    </div>
  )
}
