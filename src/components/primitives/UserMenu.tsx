'use client'

// The signed-in person's chip in a shell header: avatar, name, chevron, and the menu
// behind it.
//
// **`'use client'` is the whole reason this file exists, and it is load-bearing.** The
// markup below used to sit inline in `PortalChrome`, which is a Server Component, and
// that put an RSC boundary in the middle of a Base UI `render` prop:
//
//   <DropdownMenuTrigger render={<Button .../>} />   // trigger is client, Button was server
//
// React Flight cannot send a Server Component element across that boundary as an
// element, so it RENDERS `<Button>` first and serializes the result, which is a
// `ButtonPrimitive` element already carrying `data-slot="button"` in its props. Base UI
// then merges with `mergeProps(internalProps, render.props)`, where the rightmost object
// wins (node_modules/@base-ui/react/merge-props/mergeProps.js), so `data-slot` resolved
// to `button`. But when the same payload row is still blocked as the SSR pass consumes
// it, Flight hands back a `lazy` wrapper instead, and a lazy has no `.props`: Base UI's
// own lazy workaround in `internals/useRenderElement.js` reads `render.props` BEFORE it
// unwraps, so the merge saw `undefined` and `data-slot` resolved to
// `dropdown-menu-trigger`. Same component, two answers, one per pass. React reported it
// as a hydration mismatch on every portal page.
//
// Keeping the menu in the client graph removes the boundary: `Button` is a plain element
// on both passes, `render.props` never carries `data-slot`, and the trigger's own value
// wins consistently, exactly as it already did in `AdminTopBar` (client) and in
// `ThemeToggle` (client) next door. This is a composition on top of shadcn/ui, not a
// fork of it: every control below is still the installed primitive.

import { ChevronDownIcon, LogOutIcon, UserIcon, UsersRoundIcon } from 'lucide-react'
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export type UserMenuProps = {
  user: { name: string; email: string; initials: string; avatarUrl?: string }
  profileHref: string
  /**
   * Present only when the session was entered through the admin bar's View Portal
   * button. Absent means no `Back to Admin Mode` item, which is what a real speaker
   * must see. docs/parity/speaker-portal.md.
   */
  backToAdminHref?: string
  logoutHref?: string
}

export function UserMenu({ user, profileHref, backToAdminHref, logoutHref }: UserMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          // `plain-label`: the trigger shows the person's own name.
          <Button
            variant="ghost"
            // 36px face, 40px target: the pseudo-element grows it vertically only,
            // so it cannot reach the toggle beside it.
            className="plain-label relative h-9 gap-2 px-1.5 font-normal hit-area-y"
          >
            <Avatar size="sm">
              {user.avatarUrl === undefined ? null : <AvatarImage src={user.avatarUrl} alt="" />}
              <AvatarFallback>{user.initials}</AvatarFallback>
            </Avatar>
            <span className="max-w-40 truncate">{user.name}</span>
            <ChevronDownIcon className="text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-1.5 py-1">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href={profileHref} />}>
          <UserIcon />
          Profile
        </DropdownMenuItem>
        {/* Both of these are plain anchors rather than `Link`, and both halves of that
            are load-bearing.

            They point at route handlers that CHANGE THE SESSION, and `Link` prefetches:
            measured on the preview Worker, hovering the chip fired
            `GET /admin-mode?_rsc=...` and `GET /logout?_rsc=...` and RAN both handlers, so
            merely opening this menu signed the user out. (`prefetch={false}` also stops
            that, and an anchor is not prefetched at all.)

            And the client router follows a 303 at the FETCH layer, so it rendered the
            destination while leaving the address bar on `/portal`: a reload then hit the
            portal's login redirect carrying an admin session. An anchor is a document
            navigation, so the browser follows the redirect itself and the URL ends up
            where the response says. Nothing is lost either way, because a route handler
            has no RSC payload to warm. */}
        {backToAdminHref === undefined ? null : (
          <DropdownMenuItem render={<a href={backToAdminHref} />}>
            <UsersRoundIcon />
            Back to Admin Mode
          </DropdownMenuItem>
        )}
        {logoutHref === undefined ? null : (
          <DropdownMenuItem render={<a href={logoutHref} />}>
            <LogOutIcon />
            Logout
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
