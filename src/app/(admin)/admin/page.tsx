// `/admin` with no event: send the visitor to the one they most likely came for.
//
// WHICH one is the rule on `landingPath` below, and it is the part that was wrong rather
// than missing: this took `memberships.at(0)`, so the destination was whatever order
// Airtable happened to return, and two consecutive eval runs signed in as the organizer and
// landed on a near-empty DRAFT event with the real one one click away.
//
// This route was missing while two components already linked to it. AdminSidebar's
// wordmark link (`homeHref`) and the "Back to admin" control in PortalChrome both
// point at `/admin`, and both 404'd, because the only route under this segment is
// `[eventId]`. Demo mode made it reachable in one click, which is how it surfaced.
//
// The redirect happens in this body rather than behind a boundary, for the reason
// recorded in `[eventId]/layout.tsx`: a redirect from inside `<Suspense>` resolves after
// the shell has flushed and never produces a response, which on Workers is a hung
// request the runtime cancels. There is no `loading.tsx` next to this file for the same
// reason, since a route-level one is itself such a boundary.
//
// Not a security boundary. It reads memberships to pick a destination; the layout it
// redirects into authorizes the event, and every action under that tree authorizes
// itself (BUILD_SPEC §4).

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isAppError } from '@/constants/errorIds'
import { requireAdminUser } from '@/features/auth/guards'
import { chooseAdminLanding } from '@/features/auth/landing'
import { readLandingEvent } from '@/features/events/landing-event'
import { listMembershipsForUser } from '@/services/airtable/queries'

export const metadata = {
  title: 'bodo admin',
}

export default async function AdminIndexPage() {
  const memberships = await membershipsForCaller()

  if (memberships === 'anonymous') {
    // `next` is not decoration. Without it the magic link carries no destination and
    // `/api/auth/magic` falls back to `/portal`, which refuses a `user` session and
    // bounces the organizer straight back to the login page they just used. The
    // event-specific layout passes it for the same reason. (Codex review finding.)
    redirect(`/login?audience=admin&next=${encodeURIComponent('/admin')}`)
  }

  // The rule itself is in features/auth/landing.ts, because the demo sign-in buttons are the
  // other door into the admin app and they used to answer this question differently.
  const destination = await chooseAdminLanding(memberships, readLandingEvent)
  if (destination !== undefined) {
    redirect(destination)
  }

  // Signed in as an admin user who holds no membership anywhere. Stated rather than
  // redirected into a loop with the login page they have already used.
  //
  // It used to end at "ask an organizer to add you", which assumed somebody else had
  // already made the event. That was true while `scripts/seed` was the only thing that
  // could create one. `/admin/new` is now the other way, and this is the screen the first
  // organizer at a fresh install actually lands on.
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <Card>
        <CardHeader>
          <CardTitle>No events yet</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-4">
          <p className="text-sm text-muted-foreground">
            Your account is not a member of any event. Create one, or ask an organizer to add you to
            theirs.
          </p>
          <ButtonLink href="/admin/new">Create Event</ButtonLink>
        </CardContent>
      </Card>
    </main>
  )
}

/**
 * `anonymous` for no usable admin session, the memberships otherwise. Split out so the
 * `redirect()` calls above sit in the page body: `redirect` throws to unwind, so calling
 * it inside the try below would be caught and reported as a missing session.
 */
async function membershipsForCaller() {
  try {
    const { userId } = await requireAdminUser({ nowMs: Date.now() })
    return await listMembershipsForUser(userId)
  } catch (error) {
    if (isAppError(error) && error.id.startsWith('E_AUTH')) return 'anonymous' as const
    throw error
  }
}
