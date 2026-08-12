// Home: the My Profile card (ref 17).
//
// Header `My Profile`, then the initials avatar, the name, the email, and a `View more`
// link to the profile page. Copy verbatim from docs/parity/speaker-portal.md.
//
// Boundary inside the card, as in TasksCard: the header is the same for every speaker, so
// it flushes with the page rather than waiting behind the speaker's own record.

import { UserIcon } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { PortalCard } from '@/features/portal/PortalCard'
import { portalSession } from '@/features/portal/reads'

export function MyProfileCard() {
  return (
    <PortalCard icon={UserIcon} title="My Profile">
      <Suspense fallback={<ProfileSummarySkeleton />}>
        <ProfileSummary />
      </Suspense>
    </PortalCard>
  )
}

function ProfileSummarySkeleton() {
  return (
    <div className="flex items-center gap-3">
      <Skeleton className="size-12 rounded-lg" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-40" />
      </div>
    </div>
  )
}

async function ProfileSummary() {
  const { user } = await portalSession()

  return (
    <div className="flex items-center gap-3">
      {/* A square avatar, not a circle: ref 17 describes "avatar square with initials"
          on this card, unlike the round one in the top bar. The uploaded headshot takes
          the same square, so the card does not disagree with the profile page about what
          the speaker looks like.

          `after:rounded-lg` IS LOAD-BEARING, not a duplicate of the `rounded-lg` beside it.
          `Avatar` draws its border as a `::after` overlay, and that overlay carries its own
          `after:rounded-full`. `cn`'s twMerge treats `rounded` and `after:rounded` as
          different keys, so overriding one leaves the other: the fill went square while the
          ring stayed a circle, which is what made this look hand-rolled rather than square.
          Same shape of bug as the tab strips whose `h-8` survived an `h-auto`. */}
      <Avatar className="size-12 rounded-lg after:rounded-lg">
        {user.avatarUrl === undefined ? null : (
          <AvatarImage className="rounded-lg" src={user.avatarUrl} alt="" />
        )}
        <AvatarFallback className="rounded-lg text-base">{user.initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        {/* `h-auto p-0` on a `link` leaves the target as the 16px text box itself. The band
            grows it to 40 without moving anything: the two lines above it are text, and the
            card's own `py-4` leaves 16px below, so the 12px it takes in each direction
            reaches nothing else pressable. */}
        <ButtonLink href="/portal/profile" variant="link" className="h-auto p-0 text-xs hit-area-y">
          View more
        </ButtonLink>
      </div>
    </div>
  )
}
