// The card the portal home page is built out of, three times.
//
// Refs 17-18 show each of My Submissions, My Profile and Tasks as a card with a solid
// coloured header bar carrying an icon, a title, and sometimes a right-aligned link.
// The parity doc calls that bar blue. It is rendered here with `bg-primary` rather
// than a blue literal, because .claude/rules/ui-shadcn.md is explicit that the point
// of the token layer is that bodo's palette differs from Sessionboard's while the
// layout matches, and a hardcoded `bg-blue-600` would also be wrong in dark mode. The
// shape, the icon, the title and the action link are all as captured.

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/utils/cn'

export type PortalCardProps = {
  icon: LucideIcon
  title: string
  /** The right-aligned link in the header bar: `View All` on My Submissions. */
  action?: ReactNode
  className?: string
  contentClassName?: string
  children: ReactNode
}

export function PortalCard({
  icon: Icon,
  title,
  action,
  className,
  contentClassName,
  children,
}: PortalCardProps) {
  return (
    <Card className={cn('gap-0 overflow-hidden py-0', className)}>
      <div className="flex items-center gap-2 bg-primary px-4 py-2.5 text-primary-foreground">
        <Icon className="size-4 shrink-0" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
        {action}
      </div>
      <CardContent className={cn('px-4 py-4', contentClassName)}>{children}</CardContent>
    </Card>
  )
}
