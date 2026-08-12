'use client'

import {
  ChevronsUpDownIcon,
  MegaphoneIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useMemo, useState } from 'react'
import { ButtonLink } from '@/components/primitives/ButtonLink'
import { MetaLabel } from '@/components/primitives/MetaLabel'
import { AdminSidebarItem } from '@/components/shell/AdminSidebarItem'
import { buildAdminNav, buildReviewerNav } from '@/components/shell/admin-nav'
import { resolveActiveNavId } from '@/components/shell/admin-nav-active'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { EventSwitcher } from '@/features/events/EventSwitcher'
import { cn } from '@/utils/cn'

export type AdminSidebarEvent = {
  id: string
  /**
   * What every nav href in this sidebar addresses the event BY, which is the slug rather
   * than `id` above.
   *
   * The `[eventId]` segment accepts either (`src/features/events/event-ref.ts`), so both
   * produce working links, and the slug is chosen because these are the links an organizer
   * actually clicks: the address bar reads `/admin/ai-engineer-worlds-fair/abstracts`
   * instead of a record id for the whole session.
   *
   * **It is a separate field from `id` on purpose.** A slug must not reach anything that
   * builds a cache tag: 63 sites construct `event:{id}:...` straight from an event id, and
   * a tag built on a slug is expired by nothing, so the write lands and the screen keeps
   * serving the old rows without an error anywhere. Nothing in this component touches
   * `navRef` except href construction, and nothing downstream of an href can reach a tag.
   */
  navRef: string
  name: string
  /**
   * Already formatted, e.g. "Oct 12-14, 2026". The sidebar does not own date
   * formatting: the event's timezone lives in the data layer, and a client
   * component that formats dates itself renders a different string than the
   * server did.
   */
  dateRange: string
  initials: string
  avatarUrl?: string
}

export type AdminSidebarProps = {
  event: AdminSidebarEvent
  /**
   * Which nav to render. A `reviewer` gets their queue and nothing else; see
   * `buildReviewerNav`. Resolved on the server from EventMemberships and passed down,
   * never read from the session on the client.
   */
  role?: 'admin' | 'reviewer'
  /**
   * Where the bodo wordmark goes. The event switcher no longer uses it: choosing an event
   * is `EventSwitcher`'s modal, not a navigation.
   *
   * `/admin` is the right target for the logo specifically, because "home" for an organizer
   * IS their current event, and that is exactly what `/admin` resolves to.
   */
  homeHref?: string
  defaultCollapsed?: boolean
  className?: string
}

/**
 * A 40px pressable square centred on a control the design draws smaller. The
 * collapsed rail is `w-14` with `p-2`, so 40px is exactly the width available.
 */
const HIT_AREA = 'hit-area'

/**
 * The collapse control swaps one glyph for its mirror image, which is the kind of
 * swap that reads as a flicker when it is a mount/unmount. Both icons stay in the
 * DOM, stacked, and cross-fade, so the outgoing one has an exit and the incoming
 * one an enter. `cubic-bezier(0.2, 0, 0, 1)` stands in for the spring; there is no
 * motion library here and adding one for an icon would not be worth its bundle.
 */
const ICON_MOTION = 'transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]'
const ICON_SHOWN = 'scale-100 opacity-100 blur-[0px]'
const ICON_HIDDEN = 'scale-[0.25] opacity-0 blur-[4px]'

export function AdminSidebar({
  event,
  role = 'admin',
  homeHref = '/admin',
  defaultCollapsed = false,
  className,
}: AdminSidebarProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  // Collapsing the rail is the only state left here. There was an `openTree` accordion
  // beside it, tracking which disclosure the visitor had opened; the last collapsible went
  // on 2026-08-10 and its state with it, so the sidebar no longer has an opinion the
  // pathname cannot answer.

  const blocks = useMemo(
    () => (role === 'reviewer' ? buildReviewerNav(event.navRef) : buildAdminNav(event.navRef)),
    [event.navRef, role],
  )
  const activeId = resolveActiveNavId(blocks, pathname)

  return (
    <nav
      aria-label="Event navigation"
      data-collapsed={collapsed}
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200',
        collapsed ? 'w-14' : 'w-64',
        className,
      )}
    >
      <div className={cn('flex items-center gap-1 p-2', collapsed && 'justify-center')}>
        <ButtonLink
          href={homeHref}
          variant="ghost"
          size={collapsed ? 'icon' : undefined}
          className={cn('h-auto', HIT_AREA, collapsed ? '' : 'px-2 py-1')}
        >
          {collapsed ? (
            <MegaphoneIcon />
          ) : (
            // The boxed wordmark, straight off the reference: a 2px rule around the
            // name rather than a mark beside it. Square by construction, so it does
            // not follow --radius.
            <span
              aria-hidden
              // `normal-case`: the wordmark is a name, and the button rule in
              // globals.css would render it BODO.
              className="border-2 border-foreground px-2 py-0.5 font-heading text-base font-bold normal-case tracking-[-0.03em] text-foreground"
            >
              bodo
            </span>
          )}
          <span className="sr-only">bodo home</span>
        </ButtonLink>
      </div>

      {/* The chip and the modal behind it. It was a link to `/admin/events`, a page whose
          only job was to ask which event; switching context is not a destination, and being
          taken somewhere third to ask for it loses the page you were on. `EventSwitcher`
          owns the markup that used to be inline here, unchanged, because the chip itself is
          transcribed and only what it does changed. */}
      <EventSwitcher event={event} collapsed={collapsed} />

      <ScrollArea className="mt-2 min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 p-2">
          {blocks.map((block, blockIndex) => {
            // A labelled block carries its own divider, in the hairline that runs off the
            // end of the header. On the icon-only rail there is no header to carry it, so
            // every block after the first falls back to the plain rule.
            const header = collapsed ? undefined : block.label
            return (
              <div key={block.id} className="flex flex-col gap-0.5">
                {header === undefined && blockIndex > 0 ? <Separator className="my-2" /> : null}
                {header === undefined ? null : (
                  <div className="px-2 pt-2 pb-1">
                    <MetaLabel rule>{header}</MetaLabel>
                  </div>
                )}
                {block.items.map((item) => (
                  <AdminSidebarItem
                    key={item.id}
                    item={item}
                    active={item.id === activeId}
                    collapsed={collapsed}
                  />
                ))}
              </div>
            )
          })}
        </div>
      </ScrollArea>

      <div
        className={cn(
          'flex items-center justify-end border-t border-border p-2',
          collapsed && 'justify-center',
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className={HIT_AREA}
          onClick={() => setCollapsed(!collapsed)}
        >
          <span className="relative flex size-4 items-center justify-center">
            <PanelLeftOpenIcon
              aria-hidden
              className={cn(ICON_MOTION, 'absolute inset-0', collapsed ? ICON_SHOWN : ICON_HIDDEN)}
            />
            <PanelLeftCloseIcon
              aria-hidden
              className={cn(ICON_MOTION, collapsed ? ICON_HIDDEN : ICON_SHOWN)}
            />
          </span>
          <span className="sr-only">{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
        </Button>
      </div>
    </nav>
  )
}
