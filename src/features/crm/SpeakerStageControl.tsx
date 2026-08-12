'use client'

// The Move-to menu: the one control that moves a contact between pipeline stages.
//
// ONE component behind two surfaces, the pipeline board's cards and the CRM profile's
// header, because they are the same write and a second copy would be a second place to get
// the disabled state, the toast and the no-op case slightly differently.
//
// A `DropdownMenu` and not drag-and-drop, and that is a decision rather than a shortcut.
// @dnd-kit is in this project and the agenda uses it, but a board where the ONLY way to move
// a card is to drag it is unusable with a keyboard, unreachable on a narrow viewport, and
// silently destructive when a drop lands a pixel outside a column. The menu is the accessible
// path that a drag would have to be added on top of, so it is the one that exists first.
//
// NO `router.refresh()` after the write, matching `SpeakerTagEditor` and every other admin
// surface here: the Server Action expires the tags the Airtable client cached under
// (`invalidate()`), and its own response re-renders this route, which is what moves the card
// into its new column. A `refresh()` would add a round trip and expire nothing.
//
// COPY IS AUTHORED. The parity report waives the whole CRM area, so there is nothing to
// transcribe; the stage names are `SPEAKER_STATUS_LABELS` verbatim, which is what the event
// roster's tab strip already draws, and `Saved successfully` is the one string the parity
// docs do give for a write.

import { CheckIcon, ChevronDownIcon, LoaderCircleIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SPEAKER_STATUSES, type SpeakerStatus, speakerStatusLabel } from '@/constants/status'
import { setSpeakerStageAction } from '@/features/crm/stage-actions'
import { displayStage } from '@/features/crm/stage-history'
import { cn } from '@/utils/cn'

export function SpeakerStageControl({
  speakerId,
  stage,
  size = 'sm',
  className,
}: {
  speakerId: string
  /**
   * As stored. Absent for a contact whose stage column was never written, which is what keeps
   * their first move a real one; what the trigger SHOWS is `displayStage` of this.
   */
  stage?: SpeakerStatus
  /** `xs` on a board card, where the button sits inside a dense stack. */
  size?: 'sm' | 'xs' | 'default'
  className?: string
}) {
  const [pending, startTransition] = useTransition()
  // The stage this control is CLAIMING, from the click until the server has answered.
  //
  // A move is a `saveSpeakerProfile` plus a history append plus a revalidated re-render, and
  // that took about ten seconds on the deployed Worker. Without this the card was bit for bit
  // unchanged for all of it: the trigger still read the old stage, nothing spun, and the card
  // sat in the old column. That is the exact shape .claude/rules/ui-shadcn.md files as a dead
  // control - "a control that looks identical before and after you press it is one you press
  // again" - and pressing again is how two moves land with history rows that disagree about
  // what the previous stage was.
  //
  // It is NOT cleared on success. Once the write lands, the claimed stage IS the stage, and
  // the re-render arrives carrying the same value; clearing it would flash the old label for
  // however long the two are a tick apart. It is cleared on failure, which puts the trigger
  // back on the truth.
  const [claimed, setClaimed] = useState<SpeakerStatus | undefined>(undefined)

  // `startTransition(async () => ...)` and not the synchronous-scope form, for the reason
  // `SpeakerTagEditor` documents at length: the synchronous form returns before scheduling
  // anything, so `isPending` is false again in the same tick and `disabled={pending}` below
  // does nothing. Here that would let two clicks land two moves whose history rows disagree
  // about what the previous stage was.
  const move = (next: SpeakerStatus) => {
    setClaimed(next)
    startTransition(async () => {
      const result = await setSpeakerStageAction({ speakerId, status: next })
      if (!result.ok) {
        setClaimed(undefined)
        toast.error(result.message)
        return
      }
      // Two different true things, and saying the same one for both would be a lie about a
      // write that did not happen. `moved: false` is the contact already being on that stage.
      toast.success(result.moved ? 'Saved successfully' : `Already on ${speakerStatusLabel(next)}`)
    })
  }

  // The stage this contact is FILED UNDER, not the one stored on the record. The two differ
  // only for a contact whose column was never written, and the pipeline board draws that
  // contact in Prospect and counts them there, so a trigger reading `No stage` beside the
  // Prospect heading was the card disagreeing with its own column. See `displayStage`.
  //
  // The CLAIMED stage wins while a move is in flight, which is what makes the press visible
  // on a card that will not change column for several seconds. See `claimed`.
  const shown = claimed ?? displayStage(stage)
  const current = speakerStatusLabel(shown)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size={size}
            disabled={pending}
            // `hit-area-y` covers both call sites, and it is the only one of the three that
            // can: the trigger is a wide text button, so it needs height and no width. At
            // `xs` on a board card it is 24px tall and grows 8px each way, clearing the card
            // padding below (12px) and the subtitle above (the card's own link is 26px up).
            // At the default 32px on the profile header it grows 4px, and the header's
            // actions row wraps at `gap-1.5`, so 4 < 6 even when it wraps.
            className={cn('hit-area-y', className)}
            aria-label={
              pending ? `Moving to ${current}` : `Stage: ${current}. Move to another stage`
            }
          >
            {/* The label has already changed to the stage being written; the spinner is what
                says the write has not landed. Both, rather than either: a label that changed
                with nothing spinning claims a save that has not happened, and a spinner beside
                the old label leaves the press looking ignored. */}
            {pending ? (
              <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
            ) : null}
            {current}
            {pending ? null : <ChevronDownIcon data-icon="inline-end" />}
          </Button>
        }
      />
      <DropdownMenuContent align="start">
        {/* Grouped, because `DropdownMenuLabel` is Base UI's `Menu.GroupLabel` and throws
            outside a group. The lint rule names the fix. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Move to</DropdownMenuLabel>
          {/* Every stage, including the one they are on, and it is not disabled. A menu that
              hides the current stage makes an organizer check the trigger to find out where
              they are; showing it with a tick answers that inside the menu, and choosing it
              writes nothing (`isStageMove` in stage-history.ts).
              The tick follows the trigger rather than the stored value, for the same reason
              the trigger does: a card in the Prospect column whose menu ticked nothing would
              be the same contradiction one layer down. Choosing the ticked stage on a contact
              with no stage stored still writes it, which normalises the column and is
              recorded honestly as `'' -> Prospect`. */}
          {SPEAKER_STATUSES.map((status) => (
            <DropdownMenuItem
              key={status}
              onClick={() => {
                move(status)
              }}
            >
              {status === shown ? <CheckIcon /> : <span className="size-4" aria-hidden />}
              {speakerStatusLabel(status)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
