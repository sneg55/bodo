'use client'

// A CRM link that SAYS SO while it is navigating.
//
// WHY THIS EXISTS. The eval run of 2026-08-10 filed the dashboard's Most Sessions rows as
// dead: "rows render as interactive, hover-highlighted links but clicking one does not
// navigate anywhere; the page stays on /admin/crm/dashboard". Reproduced on the running
// server, and the rows are not dead. They navigate. Clicking `Farid Haddad` and polling the
// URL, `/admin/crm/dashboard` was still the answer a second later and
// `/admin/crm/rect6fEplf1CX6SzR` was the answer by the time the next command ran: the
// destination is a dynamic route that reads Airtable for a profile, and it deliberately has
// no `loading.tsx` (bodo-conventions.md: a boundary there turns the route's `notFound()`
// into HTTP 200 with the 404 body). So for those seconds the page is bit-for-bit unchanged,
// which is a control you press again.
//
// This is the same finding, and the same fix, as `ButtonLink`: feedback, not wiring.
// `useLinkStatus` reports the pending state of the enclosing `Link` (Next 16.2's own API,
// node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-link-status.md), so
// the row dims and shows a spinner until the navigation resolves.
//
// NOT `ButtonLink`, which paints `buttonVariants` on whatever it wraps. None of these are
// buttons: they are a table-ish row, and a whole stat tile.

import { Loader2Icon } from 'lucide-react'
import Link, { useLinkStatus } from 'next/link'
import type { ReactNode } from 'react'

import { cn } from '@/utils/cn'

/**
 * The spinner, in its own component because `useLinkStatus` only reports for the `Link` it is
 * rendered INSIDE. Called from `CrmPendingLink` itself it would always read `false`.
 *
 * `aria-hidden`, because the state assistive tech acts on is `aria-busy` on the anchor and a
 * second announcement of the same thing is noise.
 */
function PendingSpinner({ className }: { className?: string }) {
  const { pending } = useLinkStatus()
  if (!pending) return null
  return <Loader2Icon aria-hidden className={cn('size-3.5 shrink-0 animate-spin', className)} />
}

/** Marks the anchor while it navigates, so the dimming can live in CSS. */
function PendingMark() {
  const { pending } = useLinkStatus()
  return pending ? <span hidden data-pending="" /> : null
}

export function CrmPendingLink({
  href,
  className,
  spinnerClassName,
  children,
}: {
  href: string
  className?: string
  /** Where the spinner goes when the row is not a row: the stat tile parks it in a corner. */
  spinnerClassName?: string
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      // Not `pointer-events: none`: a navigation that has stalled has to stay cancellable by
      // clicking something else, which is the reason `ButtonLink` gives for dimming rather
      // than disabling.
      className={cn(className, 'has-data-pending:opacity-70')}
    >
      {children}
      <PendingMark />
      <PendingSpinner className={spinnerClassName} />
    </Link>
  )
}
