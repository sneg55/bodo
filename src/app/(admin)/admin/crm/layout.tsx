// Admin chrome for the cross-event CRM.
//
// The guard runs in this body, not inside a boundary: a `redirect()` issued from inside a
// `<Suspense>` resolves after the shell has already flushed and never produces a response,
// which on Workers is a hung request the runtime cancels. Same rule, same reason, as
// `(admin)/admin/[eventId]/layout.tsx`.
//
// It cannot reuse the per-event guard, because this tree deliberately spans events. There
// is no event id in the path to authorize, so the authorized set is the viewer's own
// EventMemberships and every read below intersects with it (`src/features/crm/scope.ts`).
//
// This layout is a convenience for a browser and NOT the security boundary: a Server Action
// is reachable by POST without it ever rendering, so each CRM action calls
// `requireCrmScope()` for itself. BUILD_SPEC section 4.
//
// The chrome is the per-event chrome, given `scope.contextEventId`. The sidebar and the top
// bar are both about an event (the switcher header, the event-scoped palette), and the CRM
// is reached from inside one, so it keeps showing the event the organizer came from rather
// than blanking the header out.

import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { Suspense } from 'react'

import { DemoBanner } from '@/components/shell/DemoBanner'
import { Skeleton } from '@/components/ui/skeleton'
import { eventRoleOf } from '@/features/auth/wiring'
import { crmScopeForViewer } from '@/features/crm/scope'

import { AdminSidebarSlot, AdminTopBarSlot } from '../[eventId]/AdminShellSlots'

export default async function CrmLayout({ children }: { children: ReactNode }) {
  const scope = await crmScopeForViewer()

  if (scope === 'anonymous') {
    // `next` is not decoration: without it the magic link carries no destination and
    // `/api/auth/magic` falls back to `/portal`, which refuses a `user` session.
    redirect(`/login?audience=admin&next=${encodeURIComponent('/admin/crm')}`)
  }
  if (scope === undefined) {
    // Signed in with no membership anywhere. Same reasoning as the per-event layout: not a
    // redirect, because the existence of other people's events is not this viewer's
    // business. Called from the body, so the 404 status line is sent with the 404 body.
    notFound()
  }

  // The chrome's nav is per-role, so it needs the role held on the event the chrome is
  // showing, not the fact that the viewer holds SOME membership somewhere. `CrmScope`
  // deliberately carries no role (both roles can read the CRM), so it is asked for here.
  // The membership list this reads is the one `crmScopeForViewer` just read, so it is the
  // same cached fetch rather than a second round trip.
  //
  // `reviewer` on absence, not `admin`: the fallback should be the narrower nav. It cannot
  // actually be absent, since `contextEventId` is one of the viewer's own memberships.
  const role = (await eventRoleOf(scope.contextEventId)) ?? 'reviewer'

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* A fact about the whole deployment rather than about this surface, so it sits above
          the sidebar and the top bar. Renders nothing when demo mode is off. */}
      <DemoBanner />

      <div className="grid min-h-0 flex-1 grid-cols-[auto_1fr]">
        {/* Behind a boundary because the sidebar needs the event record, which is an
            Airtable read: the page body next to it should not wait on the chrome. */}
        <Suspense fallback={<Skeleton className="h-full w-60" />}>
          <AdminSidebarSlot eventId={scope.contextEventId} role={role} />
        </Suspense>

        <div className="flex min-w-0 flex-col">
          {/* No boundary: the top bar reads nothing and cannot suspend. */}
          <AdminTopBarSlot eventId={scope.contextEventId} />
          <main className="min-w-0 flex-1 p-6">{children}</main>
        </div>
      </div>
    </div>
  )
}
