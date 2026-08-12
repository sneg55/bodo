// A scroll area that is CAPPED rather than fixed: it hugs short content and scrolls long.
//
// WHY THIS EXISTS. `ScrollArea` needs a DEFINITE height. Its viewport is `size-full`, and a
// percentage height inside a parent whose own height is `auto` resolves to auto as well, so
// a `ScrollArea` given only `max-h-*` never becomes a scroller at all: the content grows to
// its full height and paints over whatever follows it. That was a real, visible bug in two
// places before this existed - rows printing through the Create Portal wizard's footer, and
// a CRM pipeline column running off the bottom of the page with no scrollbar.
//
// The obvious fix is a definite `h-*`, and it works, but it trades one defect for a smaller
// one: a 256px box holding two rows is mostly empty. Most of the surfaces here are dialogs
// whose lists are usually short and occasionally long.
//
// So the cap goes on a GRID WRAPPER instead. `grid-rows-[minmax(0,1fr)]` gives the row a
// definite size once the wrapper has one, and `max-h-*` on the wrapper lets that size be
// content height until the cap bites. The `ScrollArea` inside asks for `h-full` and finally
// gets a real number to resolve against. `overflow-hidden` is what makes the cap clip rather
// than spill.
//
// All four arrangements were rendered side by side with 30 rows and with 2 before choosing:
// bare `max-h` spilled, `max-h` plus `overflow-hidden` clipped but could not scroll (worse:
// the rest is unreachable), a definite `h-*` worked but left the empty box, and this one
// capped at 30 rows, scrolled to row 30, and shrank to fit at 2.
//
// Composed here rather than by editing `src/components/ui/scroll-area.tsx`, which is
// generated and must not be styled (.claude/rules/ui-shadcn.md). A surface that genuinely
// wants a fixed height still uses `ScrollArea` directly with an `h-*`, and the CRM pipeline
// board does exactly that on purpose: its columns should fill the viewport and line up with
// each other whether or not they are full.

import type { ReactNode } from 'react'

import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/utils/cn'

export function ScrollPanel({
  className,
  children,
}: {
  /** The cap and the frame: a `max-h-*` plus whatever border and radius the surface wants. */
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('grid grid-rows-[minmax(0,1fr)] overflow-hidden', className)}>
      <ScrollArea className="h-full">{children}</ScrollArea>
    </div>
  )
}
