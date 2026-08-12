'use client'

// The roster's Speaker status cell, as a control rather than a picture of one.
//
// It was a `Badge`, and that was a dead control in the precise sense the project's UI rules
// mean: a pill reading `Prospect`, sitting under a tab strip whose tabs are Prospect and
// Confirmed, in a table where every other row action is one click. An eval agent pressed it,
// nothing happened, and it was filed as broken. It was not broken; it was a label that looked
// like a button. The two honest fixes are to stop it looking pressable or to make it work, and
// changing a speaker's status from the row is worth having: it is the single most-edited field
// on this surface and the only way to reach it before was to open the ten-field edit sheet and
// press Save.
//
// A `DropdownMenu` and not a `Select`, matching `SpeakerStageControl` in the CRM: the two are
// the same gesture over the same vocabulary, and a select trigger in a table cell reads as an
// unsaved form field rather than as a value you can move.
//
// NO `router.refresh()` after the write. The Server Action expires the tags the Airtable
// client cached under (`invalidate()`), and the roster patches the row it owns from what the
// action returned, exactly as the edit sheet's save does. A refresh here would blank the search
// box and the active tab for the sake of one field already in hand.

import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import { useTransition } from 'react'
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
import { SPEAKER_STATUS_HEADING } from '@/features/speakers/SpeakerStatusTabs'
import { setSpeakerStatusAction } from '@/features/speakers/status-actions'

export function SpeakerStatusControl({
  eventId,
  speakerId,
  speakerName,
  status,
  onChanged,
}: {
  eventId: string
  speakerId: string
  /** For the accessible name, so a screen reader on this cell knows whose status it is. */
  speakerName: string
  status: SpeakerStatus
  onChanged: (status: SpeakerStatus) => void
}) {
  const [pending, startTransition] = useTransition()

  // `startTransition(async () => ...)` and not the synchronous-scope form, for the reason
  // `SpeakerStageControl` documents: the synchronous form returns before scheduling anything,
  // so `isPending` is false again in the same tick and `disabled={pending}` does nothing.
  const move = (next: SpeakerStatus) => {
    startTransition(async () => {
      const result = await setSpeakerStatusAction({ eventId, speakerId, status: next })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      onChanged(next)
      // Two different true things, and saying the same one for both would be a lie about a
      // write that did not happen.
      toast.success(result.moved ? 'Saved successfully' : `Already ${speakerStatusLabel(next)}`)
    })
  }

  const current = speakerStatusLabel(status)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            disabled={pending}
            // `hit-area-y`: the trigger is wide enough already and 24px tall. Vertical only,
            // because the row's other controls are in neighbouring cells; the table's row
            // pitch is 32 + 16 padding + 1 border = 49, so 40 clears the rows above and
            // below by 9px.
            className="hit-area-y"
            aria-label={`${SPEAKER_STATUS_HEADING} for ${speakerName}: ${current}. Change it`}
          >
            {current}
            {/* Trips the Button's trailing optical padding
                (`has-data-[icon=inline-end]:pr-1.5` at `size="xs"`), so the caret sits
                closer to the edge than the leading label. */}
            <ChevronDownIcon data-icon="inline-end" />
          </Button>
        }
      />
      <DropdownMenuContent align="start">
        {/* Grouped, because `DropdownMenuLabel` is Base UI's `Menu.GroupLabel` and throws
            outside a group. The lint rule names the fix. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{SPEAKER_STATUS_HEADING}</DropdownMenuLabel>
          {/* Every status, including the one they hold, and it is not disabled. A menu that
              hides the current value makes an organizer check the trigger to find out where
              somebody is; showing it with a tick answers that inside the menu, and choosing
              it writes nothing. */}
          {SPEAKER_STATUSES.map((value) => (
            <DropdownMenuItem
              key={value}
              onClick={() => {
                move(value)
              }}
            >
              {value === status ? <CheckIcon /> : <span className="size-4" aria-hidden />}
              {speakerStatusLabel(value)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
