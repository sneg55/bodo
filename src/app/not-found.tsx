// What a wrong URL looks like.
//
// There was no `not-found.tsx` anywhere, so every 404 in the product was Next's own
// unstyled default: black Helvetica on white, no chrome, no theme, and no way back. That is
// reachable from more places than a typo. A public agenda or embed link that has been
// deleted lands here, on somebody else's website's referrer, and so does any admin path
// guessed from a nav label.
//
// Root-level on purpose. A `not-found.tsx` inside a route group only covers paths that
// resolve into that group's layout, and the case this exists for is a path that matches no
// route at all.

import Link from 'next/link'

import { ButtonLink } from '@/components/primitives/ButtonLink'

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="font-heading text-2xl font-semibold">This page could not be found</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The link may be out of date, or the page may have been removed.
      </p>
      {/* `/` and not the admin app: this is reachable from the public agenda and from an
          embed on somebody else's site, where an admin link would be a dead end asking a
          stranger to sign in. `/` resolves to the right place for whoever is asking. */}
      <ButtonLink href="/">Go to bodo</ButtonLink>
    </main>
  )
}
