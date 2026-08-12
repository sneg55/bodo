'use client'

// The abstract on a session card, with an IN-PLACE `Show more`. R9, EMB-01, EMB-09.
//
// The card already opens a detail dialog carrying the whole abstract, and that was judged not to
// be the affordance: a visitor scanning a list wants the rest of one paragraph without losing
// their place in the list, and a centred modal takes the list away to give it to them. So the
// card expands where it stands, and the dialog stays for everything else the detail adds.
//
// `Collapsible` from @/components/ui rather than a `useState` plus a class swap, because the
// panel is what owns the open/closed ARIA wiring and the animation, and hand-rolling either is
// the failure mode .claude/rules/ui-shadcn.md exists to stop.
//
// TWO THINGS ABOUT THE EVENTS, and both are why this is a component rather than three lines
// inlined into the views:
//
//   1. The whole card is a `DialogTrigger`. A click on `Show more` would bubble into it and open
//      the modal the control exists to avoid, so the trigger stops propagation on click AND on
//      keydown: the card is `role="button" tabIndex={0}`, so Enter and Space activate it too.
//   2. The toggle is only rendered when there is something to reveal. A control that toggles a
//      label over text that never actually clamped reads as broken (EMB-01: a Session List card,
//      wider than a day-grouped row and so fitting more characters per line, flipped `Show more`
//      to `Show less` with the paragraph byte-identical either way). That used to be judged by a
//      character count standing in for three CSS-clamped lines, and a fixed count cannot be right
//      for every card width an abstract renders at: the same description clamps in a narrow
//      day-grouped row and does not in a wide flat one. So it is judged by MEASURING the clamped
//      element instead, comparing `scrollHeight` to `clientHeight` once mounted, which is exact at
//      whatever width the card actually rendered at. That can only run client-side, so a
//      description starts un-toggleable and only ever gains the control once the measurement
//      confirms it is real, never the other way round.
//
// Rendered as HTML in both states, through `SpeakerHtml`. It used to be rendered as TEXT, and the
// comment here said why: speaker-authored markup with no sanitizer in this codebase. There is a
// sanitizer now, and the value arrives through `describeSessions`, which is a SERVER read and
// calls it. What the old rule actually bought was an embed printing `<P>NINETY MINUTES, BRING A
// LAPTOP.</P>` on a page belonging to the conference, which is its own kind of wrong.
//
// Do not add a sanitize call here. This is a client component, so it would ship the parser into
// the embed chunk and leave the raw markup in the RSC payload regardless. See `SpeakerHtml`.

import { useEffect, useRef, useState } from 'react'

import { SpeakerHtml } from '@/components/primitives/SpeakerHtml'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

export function EmbedSessionAbstract({ description }: { description: string }) {
  const [open, setOpen] = useState(false)
  // Whether the clamped paragraph genuinely overflows three lines at its rendered width.
  // `SpeakerHtml` is not a `forwardRef` component (nothing else needs it to be one), so the ref
  // sits on a plain wrapper and reads its one child, which is `SpeakerHtml`'s own root element.
  const [truncated, setTruncated] = useState(false)
  const clampRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const clamped = clampRef.current?.firstElementChild
    if (clamped === null || clamped === undefined) return
    // A pixel or two of rounding is not an overflow a visitor would ever notice, so this is
    // `> 1` rather than `> 0`: a description that clamps to the exact pixel would otherwise
    // grow a `Show more` that reveals nothing new.
    setTruncated(clamped.scrollHeight - clamped.clientHeight > 1)
  }, [description])

  if (!truncated) {
    return (
      <div ref={clampRef}>
        <SpeakerHtml
          html={description}
          className="line-clamp-3 text-pretty text-sm text-muted-foreground"
        />
      </div>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col items-start">
      {open ? null : (
        <SpeakerHtml
          html={description}
          className="line-clamp-3 text-pretty text-sm text-muted-foreground"
        />
      )}
      <CollapsibleContent>
        <SpeakerHtml html={description} className="text-pretty text-sm text-muted-foreground" />
      </CollapsibleContent>
      <CollapsibleTrigger
        render={
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0 py-0.5 text-xs"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          />
        }
      >
        {open ? 'Show less' : 'Show more'}
      </CollapsibleTrigger>
    </Collapsible>
  )
}
