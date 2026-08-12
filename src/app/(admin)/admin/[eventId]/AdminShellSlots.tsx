// The two pieces of admin chrome, kept out of layout.tsx.
//
// The sidebar is its own component so the layout can render it inside `<Suspense>`: it
// needs the event record, and the page body should not wait on that read. It takes a
// plain `eventId` string. It used to take the unawaited `params` promise, because the
// layout could not await it without making the subtree unprerenderable under
// `cacheComponents`; with that flag off the layout awaits `params` itself and there is
// one place under this tree that resolves it.
//
// There is no guard component here any more. The redirect lives in the layout body,
// because a `redirect()` from inside a Suspense boundary resolves after the shell has
// flushed and never produces a response.

import { AdminSidebar } from '@/components/shell/AdminSidebar'
import { AdminTopBar } from '@/components/shell/AdminTopBar'
import type { EventRole } from '@/constants/status'
import { actingUser } from '@/features/auth/acting-user'
import { eventDateRange, eventInitials } from '@/features/events/choices'
import { getEvent } from '@/services/airtable/queries'
import type { Event } from '@/types/domain'

export async function AdminSidebarSlot({
  eventId,
  role,
}: {
  eventId: string
  /** Resolved from EventMemberships by the layout. A reviewer gets only their queue. */
  role: EventRole
}) {
  // ONE read, and the sidebar renders on every admin page, so what is not here matters as
  // much as what is. Two others used to be:
  //
  //   - `listForms`, to resolve where the Preview row pointed. Preview was removed, so the
  //     forms list is no longer read on every page render to decide one row's destination.
  //   - `speakerListNavItems`, the CRM tree's saved-list section, which cost a
  //     `listSpeakerLists` plus a membership read to draw rows most organizers had none of.
  //     CRM is a flat link now (admin-nav.ts) and the section is gone with it.
  //
  // What is left is the event record the header chip needs, which is the one thing the
  // sidebar genuinely cannot draw without.
  const event = await getEvent(eventId)

  return <AdminSidebar event={sidebarEvent(event)} role={role} />
}

/**
 * NO `role` ANY MORE, and the top bar takes no per-role prop at all.
 *
 * It existed for one control: `View Portal`, handed a href only for an admin, because the
 * task board it pointed at is an organizer route and a reviewer would have been linked to a
 * refusal. That button was removed on 2026-08-10 (see `AdminTopBar` for why), and it was the
 * last thing in this header that a CALLER had to know the role to decide. The header still
 * differs per person, but it resolves that for itself: `actingUser` reads the identity, and
 * the ⌘K palette scopes by event and authorizes in its own Server Action.
 */
export function AdminTopBarSlot({
  eventId,
  navRef = eventId,
}: {
  eventId: string
  /**
   * The event as the URL addresses it, used for the one href here and nothing else. See
   * `AdminSidebarEvent` for why a slug must not travel further than an href.
   *
   * Defaults to `eventId` for the CRM shell, whose URL carries no event segment to take a
   * slug from and whose context event is only ever a record id. This component is
   * deliberately synchronous, so it cannot read one either: the layout above it renders it
   * outside a Suspense boundary precisely because it awaits nothing.
   */
  navRef?: string
}) {
  return (
    <AdminTopBar
      // Scopes ⌘K. The palette resolves its own results through a Server Action rather than
      // taking them as a prop, so this stays a synchronous component and the chrome still
      // needs no Suspense boundary: see the header of `GlobalSearch.tsx`.
      eventId={eventId}
      // Started here and NOT awaited, which is what keeps this component synchronous and
      // the layout's "no boundary, the top bar cannot suspend" note true: the top bar
      // resolves it behind its own Suspense boundary around the avatar. It used to be
      // `{ name: 'Organizer', email: '', initials: 'OR' }` for everybody, so a reviewer
      // signed into their own queue was told they were the organizer while the Evaluation
      // page's role chip beside it correctly said `reviewer`.
      user={actingUser(eventId)}
      // The `Profile` item has been in `AdminTopBar` since it was written, gated on this
      // prop, and NOTHING EVER PASSED IT, so the item never rendered and the name it edits
      // could only be set by opening Airtable. The route sits outside the `(organizer)`
      // group so a reviewer reaches it too: theirs are the rows that read "No name yet".
      profileHref={`/admin/${navRef}/profile`}
      logoutHref="/logout"
    />
  )
}

/**
 * The chip's four values, formatted on the server in the event's own timezone.
 *
 * `eventInitials` and `eventDateRange` moved to `src/features/events/choices.ts` when
 * the switcher modal had to draw the same event as a row: the row an organizer picks is the
 * chip it becomes, and two private copies of "how an event looks" would drift the first
 * time either was touched. The sidebar still takes a pre-formatted string, which is the
 * property that stops a client render disagreeing with the server about a date.
 */
function sidebarEvent(event: Event) {
  return {
    id: event.id,
    // Every sidebar link addresses the event by slug, so an organizer spends the session on
    // `/admin/ai-engineer-worlds-fair/...` rather than on a record id. Safe here and only
    // here: `navRef` is consumed by href construction alone (see `AdminSidebarEvent`).
    navRef: event.slug,
    name: event.name,
    initials: eventInitials(event.name),
    // `AdminSidebar` has always had the slot for it; nothing filled it, so an event with a
    // logo uploaded in Image Settings still showed two letters in the switcher. The
    // initials stay as the fallback for an event with no logo.
    avatarUrl: event.logoUrl,
    dateRange: eventDateRange(event.startsAt, event.endsAt, event.timezone),
  }
}
