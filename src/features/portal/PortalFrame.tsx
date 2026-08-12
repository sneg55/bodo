// The portal shell, and the boundary that keeps its chrome off the critical path.
//
// `PortalChrome` needs three strings about the signed-in speaker, and getting them means
// reading the session cookie and then the Speakers record. That read sits inside a
// `<Suspense>` boundary so the layout it draws does not wait on Airtable.
//
// The fallback is the same chrome with an empty user chip, NOT a bare skeleton, and that
// is the whole point of the arrangement: the page title, the horizontal rule, the pill nav
// and the page's own card frames all flush first, so the layout is painted and finished
// before the name in the top right arrives. A skeleton fallback would send a grey box in
// their place and give back the fast first paint the boundary exists to buy.
//
// It also means `pageTitle` and `activeNav` come from the page rather than the layout,
// which is unavoidable: a layout cannot know which pill is active, and the four portal
// pages are four different titles.

import type { ReactNode } from 'react'
import { Suspense } from 'react'

import { PortalChrome, type PortalNavId } from '@/components/shell/PortalChrome'
import { portalSession } from '@/features/portal/reads'

export type PortalFrameProps = {
  pageTitle: string
  activeNav: PortalNavId
  children: ReactNode
}

/**
 * Rendered until the speaker record resolves, then replaced. Blank rather than invented:
 * a placeholder name would be a different person's name for one frame.
 */
const PENDING_USER = { name: '', email: '', initials: '' }

export function PortalFrame({ pageTitle, activeNav, children }: PortalFrameProps) {
  return (
    <Suspense
      fallback={
        <PortalChrome user={PENDING_USER} pageTitle={pageTitle} activeNav={activeNav}>
          {children}
        </PortalChrome>
      }
    >
      <IdentifiedChrome pageTitle={pageTitle} activeNav={activeNav}>
        {children}
      </IdentifiedChrome>
    </Suspense>
  )
}

async function IdentifiedChrome({ pageTitle, activeNav, children }: PortalFrameProps) {
  const { user, impersonating } = await portalSession()
  return (
    <PortalChrome
      user={user}
      pageTitle={pageTitle}
      activeNav={activeNav}
      // From the session's own claim, so a real speaker cannot be shown the item by
      // visiting `?impersonating=1`. The fallback above never sets it, which is right: it
      // renders before the session is resolved, and guessing would flash the item at
      // whoever is loading the page.
      impersonating={impersonating}
      backToAdminHref="/admin-mode"
      logoutHref="/logout"
    >
      {children}
    </PortalChrome>
  )
}
