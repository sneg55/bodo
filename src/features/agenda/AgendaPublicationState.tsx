// What the public agenda currently shows, said in words next to the two buttons.
//
// `Unpublish Agenda` and `Publish Agenda` sit side by side at all times, so the toolbar
// offered both directions and stated neither: nothing on the screen answered "is the
// agenda live right now". Their disabled states hint at it, and a disabled button is a
// weak signal for the one question this surface is judged on. So the counts are shown.

import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, CircleDotIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function AgendaPublicationState({
  publishedCount,
  scheduledCount,
  withheldCount,
}: {
  /** Rows marked published, whether or not a visitor can actually see them. */
  publishedCount: number
  /** Placed but not published. Published plus this is everything a visitor could see. */
  scheduledCount: number
  /**
   * Published rows a visitor CANNOT see, because their content has not been approved. A
   * subset of `publishedCount`.
   *
   * The whole reason this prop exists: the content gate in `publicSessionRows` would
   * otherwise be invisible from the screen the organizer publishes on, and they would go
   * looking for a bug in the public page.
   *
   * WHAT COUNTS DEPENDS ON THE AGENDA, and the caller has to decide it, because this
   * component sees counts and not rows. `pending_review` and `changes_requested` always
   * count. `not_submitted` counts only once some session on the agenda is `approved`, which
   * is when approval becomes the rule: before that a session nobody has uploaded anything
   * for is public and is not waiting on anybody, so counting it would report an event-sized
   * backlog that does not exist. Derive it with `contentApprovalRequired` and pass the same
   * flag to `publicWithholding`, so the toolbar cannot disagree with the public page.
   */
  withheldCount: number
}) {
  if (publishedCount === 0) {
    return (
      <Badge variant="outline" className="tabular-nums">
        <CircleDashedIcon />
        Not published
      </Badge>
    )
  }

  const liveCount = publishedCount - withheldCount

  // Said FIRST, ahead of the published/scheduled split, because it is the answer to
  // "I published it and the public page is empty" and that question is urgent.
  if (withheldCount > 0) {
    return (
      <Tooltip>
        {/* A Button and not the bare Badge: a <span> is not focusable, so a tooltip hung
            off one is unreachable by keyboard. Same reason TaskSection wraps its icon.

            `plain-label` because of that wrapper and only that wrapper. `font-mono` and
            `uppercase` inherit, and the Badge sets neither, so the machine-label treatment
            reached a sentence it was never meant for: this branch read
            "3 LIVE, 2 AWAITING CONTENT APPROVAL" in mono while the three sibling badges
            below - same component, same toolbar slot, no Button around them - stayed in
            sans sentence case. The label is a status readout, not a command.

            `hit-area-y` because that wrapper is the problem it also creates: `h-auto py-0`
            around an `h-5` Badge is a 22px-tall target, and it is the only way to reach the
            explanation of why a published session is missing from the public page. It is
            wide already, so the area grows on the short axis only. The toolbar row is 32px
            of `h-8` siblings with `gap-2` between wrapped rows, so 40px reaches 4px into an
            8px gap and stops short of the row above and below. */}
        <TooltipTrigger
          render={
            <Button variant="ghost" size="sm" className="plain-label h-auto px-1 py-0 hit-area-y">
              <Badge variant="destructive" className="tabular-nums">
                <CircleAlertIcon />
                {liveCount} live, {withheldCount} awaiting content approval
              </Badge>
            </Button>
          }
        />
        <TooltipContent className="max-w-72">
          A published session stays off the public agenda while its Content status is Pending review
          or Changes requested. Once any session here is Approved, only Approved sessions are
          public. Set it on the session, under Content.
        </TooltipContent>
      </Tooltip>
    )
  }

  if (scheduledCount === 0) {
    return (
      <Badge variant="secondary" className="tabular-nums">
        <CircleCheckIcon />
        Published, {publishedCount} {publishedCount === 1 ? 'session' : 'sessions'} live
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="tabular-nums">
      <CircleDotIcon />
      Partly published, {publishedCount} of {publishedCount + scheduledCount} live
    </Badge>
  )
}
