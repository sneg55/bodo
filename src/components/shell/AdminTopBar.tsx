'use client'

// The admin header: ⌘K search, the theme toggle and the account menu.
//
// **Three of the reference's controls do not ship here, and it is the same reason each time.**
// The Announcements bell and the Help icon went first: both rendered from an optional href
// nothing ever passed, so they were enabled buttons that swallowed a click, and there is no
// announcements feed and no help centre behind them in this build. `View Portal` followed on
// 2026-08-10, on the owner's instruction, and it is the interesting one: entering the portal
// means becoming a PARTICULAR speaker, and a button in the chrome has nobody in mind. It first
// pointed at `/portal`, whose guard refuses an admin subject, so it was a link to
// `/login?next=%2Fportal` whose prefetch logged `requires a speaker session` on every admin page
// load. It was then repointed at the task board, which made it a second, vaguer route to a page
// already one click away in the sidebar.
//
// The capability is not lost, and that is why the button could go: the task board carries
// `ViewPortalAsSpeaker` per row, which enters the portal AS a named speaker and is what the
// parity docs' impersonation flow actually describes.
//
// A control that cannot answer is worse than an absent one. Add any of the three back in the
// same change that gives it a destination, not before.

import Link from 'next/link'
import { Suspense, use } from 'react'
import { ThemeToggle } from '@/components/shell/ThemeToggle'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/utils/cn'
import { GlobalSearch } from './GlobalSearch'

export type AdminTopBarUser = { name: string; email: string; initials: string; avatarUrl?: string }

export type AdminTopBarProps = {
  /** Scopes the ⌘K palette: its results and its destinations are all inside one event. */
  eventId: string
  /**
   * A PROMISE, unresolved, and that is the point.
   *
   * The three strings come from the acting user's `AdminUsers` row, which is an Airtable
   * read, and the layout renders this slot with no Suspense boundary around it: awaiting the
   * read on the server would hold the whole shell, `{children}` included, behind a name.
   * Handing the promise across and resolving it with `use()` puts the boundary around the
   * avatar alone, so everything else paints first. See BUILD_SPEC 6.1.
   *
   * It must not reject. `actingUser` resolves an unknown identity to a chip rather than
   * throwing, because the alternative is the admin chrome erroring on every page.
   */
  user: Promise<AdminTopBarUser>
  /**
   * Nothing passes this, on purpose: there is no admin profile route in this build, only
   * `/portal/profile`, which is a speaker surface. The `Profile` item appears in the same
   * change that adds the page, the same rule the header states for the removed controls.
   */
  profileHref?: string
  logoutHref?: string
  className?: string
}

export function AdminTopBar({
  eventId,
  user,
  profileHref,
  logoutHref,
  className,
}: AdminTopBarProps) {
  return (
    <header
      className={cn(
        'flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3',
        className,
      )}
    >
      {/* Trigger, dialog and query state all live in there together. They used to live
          here, split across a `searchGroups` prop this component defaulted to `[]`, which
          is exactly how the palette ended up unable to return a result. The `>_` prompt
          the reference puts on its search field moved in there with the trigger. */}
      <GlobalSearch eventId={eventId} />

      {/* `gap-2`, not `gap-1`: both controls in here carry a 40px pressable area under a
          32px face, and 8px is the narrowest gap at which those two areas meet without
          overlapping. Two interactive elements must never share a pixel of hit area. */}
      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />

        {/* Only the avatar waits, and only for as long as the member read takes. A skeleton
            the size of the trigger, so the row does not reflow when the name arrives. */}
        <Suspense fallback={<Skeleton className="size-8 rounded-full" />}>
          <AccountMenu user={user} profileHref={profileHref} logoutHref={logoutHref} />
        </Suspense>
      </div>
    </header>
  )
}

/**
 * The avatar and the account dropdown. Split out for the Suspense boundary above: `use()`
 * suspends, and this is the only part of the header that needs the identity.
 */
function AccountMenu({
  user,
  profileHref,
  logoutHref,
}: {
  user: Promise<AdminTopBarUser>
  profileHref?: string
  logoutHref?: string
}) {
  const person = use(user)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" className="rounded-full hit-area">
            <Avatar size="sm">
              {person.avatarUrl === undefined ? null : (
                <AvatarImage src={person.avatarUrl} alt={person.name} />
              )}
              <AvatarFallback>{person.initials}</AvatarFallback>
            </Avatar>
            <span className="sr-only">{person.name}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-1.5 py-1">
          <p className="truncate text-sm font-medium">{person.name}</p>
          {/* Absent, not blank, when the row could not be resolved: an empty line under the
              name reads as a missing address rather than as an unknown account. */}
          {person.email === '' ? null : (
            <p className="truncate text-xs text-muted-foreground">{person.email}</p>
          )}
        </div>
        <DropdownMenuSeparator />
        {profileHref === undefined ? null : (
          <DropdownMenuItem render={<Link href={profileHref} />}>Profile</DropdownMenuItem>
        )}
        {logoutHref === undefined ? null : (
          // A plain anchor, for the two reasons the same control in `PortalChrome`
          // carries. `/logout` is a route handler that clears the session and `Link`
          // prefetches, so hovering the avatar signed the organizer out, measured on the
          // preview Worker. And the client router follows the handler's 303 at the fetch
          // layer, which left the address bar on the admin page it had just signed out
          // of. An anchor is a document navigation, so neither happens.
          <DropdownMenuItem render={<a href={logoutHref} />}>Logout</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
