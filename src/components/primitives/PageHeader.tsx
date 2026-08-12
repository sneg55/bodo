// PageHeader: the band every admin route opens with.
//
// Eight routes hand-rolled the same block before this existed (icon tile, h1,
// subtitle, sometimes an actions row), which is why five of them drifted apart on
// `items-center` vs `items-start` and on whether the tile shrank. One component
// now owns the treatment: the gradient wash, the outlined gold tile, and the
// hairline that separates the header from the body.
//
// It renders a <header> and nothing else. Tabs, toolbars and content stay with
// the surface that owns them, because a header that also owned the tab strip
// would need to know about every page's query state.

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

export type PageHeaderProps = {
  title: string
  /** One line under the title. Comes verbatim from the parity docs. */
  description?: ReactNode
  icon?: LucideIcon
  /**
   * The icon as a finished element, for surfaces that pick it out of a lookup.
   * `react-hooks/static-components` refuses a component pulled from a map and
   * rendered as `<Icon />`, so those maps hold elements (see `SCOPE_ICONS` in
   * AbstractsTable). Ignored when `icon` is given.
   */
  iconSlot?: ReactNode
  /** Buttons, menus, the primary CTA. Right-aligned, wraps under on narrow. */
  actions?: ReactNode
  /** Status tabs or a sub-nav, rendered flush to the bottom edge of the band. */
  below?: ReactNode
  /** Back arrows and the like, left of the tile. */
  leading?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  iconSlot,
  actions,
  below,
  leading,
  className,
}: PageHeaderProps) {
  const tile = Icon === undefined ? iconSlot : <Icon className="size-5" />
  return (
    <header
      className={cn(
        // The wash reads as a lit corner rather than a coloured bar: it is the
        // one place gold appears as a surface rather than as a mark.
        'relative -mx-6 -mt-6 mb-1 border-b border-border bg-card px-6 pt-6',
        'before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(120%_180%_at_0%_0%,var(--color-primary)_0%,transparent_55%)] before:opacity-[0.09]',
        below === undefined && 'pb-6',
        className,
      )}
    >
      <div className="relative flex flex-wrap items-start gap-3">
        {leading}
        {tile === undefined ? null : (
          <div className="flex size-10 shrink-0 items-center justify-center border border-primary/45 bg-primary/8 text-primary">
            {tile}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-balance font-heading text-2xl font-semibold">{title}</h1>
          {description === undefined ? null : (
            <p className="max-w-3xl text-pretty text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions === undefined ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>
        )}
      </div>
      {below === undefined ? null : <div className="relative mt-4">{below}</div>}
    </header>
  )
}
