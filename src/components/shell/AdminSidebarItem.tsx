'use client'

import { cva } from 'class-variance-authority'
import Link from 'next/link'
import { ButtonLink } from '@/components/primitives/ButtonLink'
import type { AdminNavLeaf } from '@/components/shell/admin-nav'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/utils/cn'

/**
 * The selected state is "a blue pill with an outline" in the product. Expressed
 * against the primary token rather than a literal blue so the palette layer stays
 * the one place bodo's colour differs from Sessionboard's, and so it survives dark
 * mode. A tinted fill plus a matching border is what reads as an outlined pill at
 * both ends of the theme. The pill shape itself is parity and stays, even though
 * the reference site marks its active item with a left bar: the parity docs win
 * on presentation.
 *
 * `plain-label` opts these out of the mono-uppercase treatment globals.css gives
 * every button. Destination names are navigation, not machine labels, and the
 * switcher next to them carries an event name the organiser typed.
 *
 * The explicit `transition-[...]` list overrides the `transition-all` that
 * `buttonVariants` sets on every button. `all` means the browser watches every
 * property on the row the visitor's pointer lives on, and it animates the focus
 * ring in, which should be instant. Named properties also keep the transition
 * interruptible without pulling anything else along with them.
 */
export const sidebarItemVariants = cva(
  'plain-label h-8 w-full justify-start gap-2 border font-normal transition-[color,background-color,border-color,translate] duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
  {
    variants: {
      state: {
        idle: 'border-transparent text-foreground/80',
        active:
          'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
      },
      depth: {
        root: 'px-2',
        child: 'px-2 pl-5',
      },
    },
    defaultVariants: { state: 'idle', depth: 'root' },
  },
)

export type AdminSidebarItemProps = {
  item: AdminNavLeaf
  active: boolean
  /** Icon-only rail. The label moves into a tooltip so it stays reachable. */
  collapsed: boolean
  depth?: 'root' | 'child'
}

export function AdminSidebarItem({ item, active, collapsed, depth }: AdminSidebarItemProps) {
  const Icon = item.icon

  const trigger = (
    <ButtonLink
      href={item.href}
      variant="ghost"
      aria-current={active ? 'page' : undefined}
      className={cn(
        sidebarItemVariants({
          state: active ? 'active' : 'idle',
          depth: collapsed ? 'root' : depth,
        }),
        collapsed && 'justify-center px-0',
      )}
    >
      <Icon className="shrink-0" />
      {collapsed ? <span className="sr-only">{item.label}</span> : null}
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </ButtonLink>
  )

  if (!collapsed) {
    return trigger
  }

  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}
