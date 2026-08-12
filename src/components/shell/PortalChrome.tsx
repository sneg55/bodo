import { cva } from 'class-variance-authority'
import { BookOpenIcon, BriefcaseIcon, CalendarIcon, HouseIcon, UserIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { ButtonLink } from '@/components/primitives/ButtonLink'
import { UserMenu } from '@/components/primitives/UserMenu'
import { ThemeToggle } from '@/components/shell/ThemeToggle'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/utils/cn'

export type PortalNavId = 'home' | 'submissions' | 'profile' | 'tasks' | 'resources'

export type PortalNavHrefs = {
  home: string
  submissions: string
  profile: string
  tasks: string
  resources: string
}

export type PortalChromeProps = {
  user: { name: string; email: string; initials: string; avatarUrl?: string }
  /** Rendered centred above the rule. "Home", "Profile", and so on. */
  pageTitle: string
  activeNav: PortalNavId
  /**
   * `Back to Admin Mode` only exists because the session was entered through the
   * admin bar's View Portal button. A real speaker must never see it, so it is
   * off unless the caller says otherwise. docs/parity/speaker-portal.md.
   */
  impersonating?: boolean
  navHrefs?: PortalNavHrefs
  backToAdminHref?: string
  logoutHref?: string
  children: ReactNode
}

const DEFAULT_NAV_HREFS: PortalNavHrefs = {
  home: '/portal',
  submissions: '/portal/submissions',
  profile: '/portal/profile',
  tasks: '/portal/tasks',
  resources: '/portal/resources',
}

/**
 * Active pill is outlined, matching the portal screenshots.
 *
 * `pl-2.5 pr-3` and not `px-3`: every pill leads with an icon, and equal padding
 * on both ends makes an icon-then-text row look pushed to the right. Two pixels
 * off the icon side is the usual correction.
 *
 * The `after:` block is the pressable area. The pill draws 32px tall and these
 * are the portal's only navigation, so the target is grown to 40 underneath
 * without moving the pill. It is inset horizontally so two pills side by side
 * cannot share a pixel, and the nav's own `gap-2` is exactly the row spacing at
 * which two wrapped rows meet without overlapping.
 */
const pillVariants = cva(
  'relative h-8 gap-1.5 rounded-4xl border pl-2.5 pr-3 font-normal transition-[color,background-color,border-color,translate] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hit-area-y',
  {
    variants: {
      state: {
        idle: 'border-transparent text-foreground/80',
        active:
          'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
      },
    },
    defaultVariants: { state: 'idle' },
  },
)

export function PortalChrome({
  user,
  pageTitle,
  activeNav,
  impersonating = false,
  navHrefs = DEFAULT_NAV_HREFS,
  backToAdminHref = '/admin',
  logoutHref,
  children,
}: PortalChromeProps) {
  // A list, not a record lookup, so the active pill is a comparison rather than a
  // dynamic index into a plain object (which security/detect-object-injection
  // flags, and that warning fails the build).
  const pills: readonly { id: PortalNavId; label: string; href: string; icon: typeof HouseIcon }[] =
    [
      { id: 'home', label: 'Home', href: navHrefs.home, icon: HouseIcon },
      { id: 'submissions', label: 'Submissions', href: navHrefs.submissions, icon: CalendarIcon },
      { id: 'profile', label: 'Profile', href: navHrefs.profile, icon: UserIcon },
      { id: 'tasks', label: 'Tasks', href: navHrefs.tasks, icon: BriefcaseIcon },
      // A FIFTH pill, and it is authored rather than transcribed. Refs 17-18 show four,
      // captured on an event that had no resource pages, and there is no screenshot of a
      // portal resources surface at all. R8's acceptance criterion is that a speaker can
      // VIEW a resource page, which needs a way in, and the product's own admin nav carries
      // `Resources` under PORTALS (docs/parity/portal-tasks-forms.md), so a pill for it is
      // the smallest addition consistent with both.
      //
      // It renders unconditionally rather than only when the event has pages. Making it
      // conditional needs an Airtable read in the shell, and the shell resolves inside a
      // `<Suspense>` boundary whose fallback would then have four pills and its resolved
      // state five: the centred nav would visibly re-centre on every portal page load. A
      // page that is always reachable and says `No resources found.` is the better trade.
      { id: 'resources', label: 'Resources', href: navHrefs.resources, icon: BookOpenIcon },
    ]

  return (
    <div className="flex min-h-full flex-col bg-background">
      {/* No admin sidebar here: the portal is its own shell. BUILD_SPEC 5.2. */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        {/* The boxed wordmark the admin sidebar carries. The portal had no mark at
            all, so a speaker arriving from a magic link saw a page with no name on
            it. */}
        <span
          aria-hidden
          className="border-2 border-foreground px-1.5 py-0.5 font-heading text-sm font-bold tracking-[-0.03em]"
        >
          bodo
        </span>
        {/* `gap-2`: the theme toggle's 40px hit area overhangs its 32px face by 4px on
            each side, and 8px is the narrowest gap that keeps it clear of the chip. */}
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <UserMenu
            user={user}
            profileHref={navHrefs.profile}
            backToAdminHref={impersonating ? backToAdminHref : undefined}
            logoutHref={logoutHref}
          />
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <h1 className="text-center font-heading text-2xl font-medium">{pageTitle}</h1>
        <Separator className="mt-4" />
        <nav aria-label="Portal" className="flex flex-wrap justify-center gap-2 py-4">
          {pills.map((pill) => {
            const Icon = pill.icon
            const active = pill.id === activeNav
            return (
              <ButtonLink
                href={pill.href}
                key={pill.id}
                variant="ghost"
                aria-current={active ? 'page' : undefined}
                className={cn(pillVariants({ state: active ? 'active' : 'idle' }))}
              >
                <Icon />
                {pill.label}
              </ButtonLink>
            )
          })}
        </nav>
        {children}
      </div>
    </div>
  )
}
