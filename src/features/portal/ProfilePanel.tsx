'use client'

// A collapsible profile panel. Ref 18 shows `General` and `My Links` each with a
// chevron-up collapse control at the top right, both open.
//
// Open by default, because that is the captured state and a speaker landing on a
// collapsed form has nothing to fill in.

import { ChevronUpIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/utils/cn'

export function ProfilePanel({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true)

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader>
          <CardTitle className="text-sm">{title}</CardTitle>
          {/* `CardAction` and not flex utilities on the header. `CardHeader` is a grid,
              so a `flex-row justify-between` there sets no `display` and does nothing:
              the trigger drops to the second grid row, left-aligned under the title,
              which is what it was doing. This slot is the header's own top-right cell,
              and it is what switches the grid to two columns. */}
          <CardAction>
            <CollapsibleTrigger
              render={
                // 28px square with room on every side, so the plain square and not the
                // band: `--card-spacing` is 16px, which puts the card edge 30px above this
                // centre and the first field 30px below it, and the header's own title is
                // the only thing to its left.
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="hit-area"
                  aria-label={`Collapse ${title}`}
                >
                  <ChevronUpIcon className={cn('transition-transform', !open && 'rotate-180')} />
                </Button>
              }
            />
          </CardAction>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>{children}</CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
