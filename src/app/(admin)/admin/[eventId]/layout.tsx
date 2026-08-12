// Admin chrome for one event.
//
// The guard runs in this body, which is where a redirect belongs and is not negotiable:
// a `redirect()` issued from inside a `<Suspense>` boundary resolves after the shell has
// already flushed, and at that point it never produces a response. On Workers that was a
// hung request the runtime cancelled, which is a 500 to the visitor. So the session read
// happens here, before the first byte.
//
// This body awaits `params` and reads the session cookie, and both are ordinary now that
// Cache Components is off (next.config.ts). While it was on, either read made the whole
// subtree unprerenderable, which is what the deleted `unstable_instant = false` was
// suppressing.
//
// The redirect is a convenience for a browser and NOT the security boundary. A Server
// Action is reachable by POST without this ever rendering, so every action under this
// tree calls requireEventRole for itself. BUILD_SPEC section 4.
//
// Any membership gets through here, `reviewer` included, and that is correct: the
// reviewer's queue is under this layout too. What a reviewer must NOT reach is the
// organizer's surfaces, and that line is drawn one level down, by the `(organizer)`
// route group's own layout. The role resolved here is passed to the chrome so the nav
// and the top bar offer a reviewer only what they can actually open.

import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { Suspense } from 'react'

import { DemoBanner } from '@/components/shell/DemoBanner'
import { Skeleton } from '@/components/ui/skeleton'
import { isAppError } from '@/constants/errorIds'
import type { EventRole } from '@/constants/status'
import { eventRoleOf } from '@/features/auth/wiring'
import { requireEventId } from '@/features/events/resolve-ref'

import { AdminSidebarSlot, AdminTopBarSlot } from './AdminShellSlots'

export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ eventId: string }>
}) {
  // `eventRef` is what the URL carries and may be either a record id or the event's slug
  // (src/features/events/event-ref.ts). It is kept, unresolved, for the two things below
  // that are links: the login bounce and the profile item. Everything that READS uses
  // `eventId`, and nothing hands `eventRef` to anything that can build a cache tag.
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)
  const role = await currentRole(eventId)

  if (role === 'anonymous') {
    redirect(`/login?audience=admin&next=${encodeURIComponent(`/admin/${eventRef}`)}`)
  }
  if (role === undefined) {
    // Signed in, but no membership on this event. Deliberately not a redirect: telling
    // someone that an event exists but is not theirs is information they did not have.
    notFound()
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Above the sidebar and the top bar rather than inside the content column: it is
          a fact about the whole deployment, not about this event. Renders nothing when
          demo mode is off, which is every ordinary deployment. */}
      <DemoBanner />

      <div className="grid min-h-0 flex-1 grid-cols-[auto_1fr]">
        {/* Kept behind a boundary because the sidebar needs the event record, which is an
            Airtable read: the page body next to it should not wait on the chrome. */}
        <Suspense fallback={<Skeleton className="h-full w-60" />}>
          <AdminSidebarSlot eventId={eventId} role={role} />
        </Suspense>

        <div className="flex min-w-0 flex-col">
          {/* No boundary HERE, and the reason changed. The slot itself is still synchronous:
              it awaits nothing, so it cannot suspend this subtree. What it does now is START
              the acting user's read and hand the unresolved promise to the top bar, which
              resolves it with `use()` behind a boundary around the account menu alone. So the
              shell and `{children}` paint without waiting on an Airtable read, and only the
              avatar shows a skeleton. Wrapping the slot here instead would put the whole
              header behind that one name. */}
          <AdminTopBarSlot eventId={eventId} navRef={eventRef} />
          <main className="min-w-0 flex-1 p-6">{children}</main>
        </div>
      </div>
    </div>
  )
}

/**
 * Three answers, deliberately distinct: `anonymous` for no session at all, `undefined`
 * for a signed-in user with no membership on this event, and the role otherwise. They
 * lead to different places, and collapsing them would bounce a signed-in reviewer back
 * to a login page they have already used.
 */
async function currentRole(eventId: string): Promise<EventRole | undefined | 'anonymous'> {
  try {
    return await eventRoleOf(eventId)
  } catch (error) {
    if (isAppError(error) && error.id.startsWith('E_AUTH')) return 'anonymous'
    throw error
  }
}
