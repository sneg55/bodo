'use client'

// A link that LOOKS like a button, and SAYS SO while it is navigating.
//
// WHY THIS EXISTS. The eval run of 2026-08-10 filed `EDIT PLAN` on the Evaluation header as
// a dead control: "clicked repeatedly with no dialog, no URL change and no visible effect
// (an RSC prefetch to /evaluation/plan does fire)". Reproduced on a running server, and the
// control is not dead. It navigates. It takes four to six seconds to do it, because the
// destination is a dynamic route that reads Airtable, and in those seconds the page is
// bit-for-bit unchanged: no spinner, no disabled state, nothing. A control that looks
// identical before and after you press it is one you press again, which is exactly what the
// agent did and exactly what a user does.
//
// So the fix is feedback, not wiring. `useLinkStatus` reports the pending state of the
// enclosing `Link` (Next 16.2's own API for this, see
// node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-link-status.md), and
// the button dims and shows a spinner until the navigation resolves.
//
// It is also a plain `Link` rather than a `Button` with `nativeButton={false}` and a
// `render` of one, which was the pattern everywhere. That produces `<a role="button">`:
// the semantics are wrong for something that navigates, a screen reader announces a button
// that turns out to be a link, and it routes a plain anchor through Base UI's button
// activation emulation for no gain. `buttonVariants` is exported for exactly this and is
// the shadcn-documented way to style a link as a button, so the appearance still comes from
// the single `cva` definition and a variant added there reaches these too.
//
// Use `Button` for anything that RUNS code. Use this for anything that GOES somewhere.

import { Loader2Icon } from 'lucide-react'
import Link, { useLinkStatus } from 'next/link'
import type { ComponentProps } from 'react'

import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/utils/cn'

/**
 * The spinner, in its own component because `useLinkStatus` only reports for the `Link` it
 * is rendered INSIDE. Called from `ButtonLink` itself it would always read `false`.
 *
 * `aria-hidden`, because the state that matters to assistive tech is `aria-busy` on the
 * anchor, and a second announcement of the same thing is noise.
 */
function PendingSpinner() {
  const { pending } = useLinkStatus()
  if (!pending) return null
  return (
    <Loader2Icon
      aria-hidden
      // Fades in rather than blinking in. `starting:` is `@starting-style`, so this is a
      // real CSS TRANSITION on a freshly mounted element and not a keyframe: it retargets
      // if the navigation resolves inside the 200ms, where an animation would have to play
      // itself out. Nothing else changes - same mount, same spin, same `data-icon` so the
      // button still tightens its trailing padding. Browsers without `@starting-style` skip
      // the fade and get today's behaviour.
      className="animate-spin opacity-100 transition-opacity duration-200 ease-[cubic-bezier(0.2,0,0,1)] starting:opacity-0"
      data-icon="inline-end"
    />
  )
}

/**
 * Dims the link while it navigates, without disabling it.
 *
 * NOT `pointer-events: none`: a navigation that has stalled has to stay cancellable by
 * clicking something else, and a control that swallows clicks while it waits is the same
 * failure this component exists to fix, one layer down.
 */
function PendingClass() {
  const { pending } = useLinkStatus()
  return pending ? <span hidden data-pending="" /> : null
}

export type ButtonLinkProps = ComponentProps<typeof Link> &
  Parameters<typeof buttonVariants>[0] & {
    /**
     * Renders a non-navigable placeholder instead of a link.
     *
     * There is no such thing as a disabled anchor: `disabled` is not a valid attribute on
     * one, and an `<a href>` stays keyboard-reachable and openable in a new tab however it
     * is styled. So a disabled ButtonLink is a `<span>` with the same classes and
     * `aria-disabled`, which is the accessible pattern and, more to the point here, is the
     * only one that actually refuses the navigation. Two callers need it: View Form before
     * a form is published, and + Add for a viewer with no edit rights.
     */
    disabled?: boolean
  }

export function ButtonLink({
  className,
  variant,
  size,
  children,
  disabled = false,
  ...props
}: ButtonLinkProps) {
  const appearance = cn(
    buttonVariants({ variant, size, className }),
    // Scoped to the marker the pending child renders, so the whole state lives in CSS and
    // this component does not have to be split into a wrapper and an inner.
    //
    // The dim is a TRANSITION, and the property list is spelled out. `buttonVariants` opens
    // with `transition-all`, which tailwind-merge replaces with whatever transition utility
    // comes last, so naming the properties here both gets the dim animating and takes this
    // one component off `transition-property: all`. The list is everything the variants
    // actually change: hover swaps background and text colour, focus-visible swaps the
    // border and draws the ring as a box-shadow, `active:translate-y-px` nudges it, and
    // `disabled` plus this pending state move opacity. 200ms is long enough to read as a
    // response to the press without lagging a navigation that returns quickly.
    'transition-[opacity,color,background-color,border-color,box-shadow,translate] duration-200 ease-[cubic-bezier(0.2,0,0,1)]',
    'has-data-pending:opacity-70',
  )

  if (disabled) {
    return (
      <span aria-disabled className={cn(appearance, 'pointer-events-none opacity-50')}>
        {children}
      </span>
    )
  }

  return (
    <Link data-slot="button" className={appearance} {...props}>
      {children}
      <PendingClass />
      <PendingSpinner />
    </Link>
  )
}
