'use client'

// "Assign to specific speakers": pick who a task goes to, off the event's whole roster.
//
// THE HOLE THIS FILLS. Assigning had exactly one path, "Assign to accepted speakers", so a
// task could only ever reach the accepted cast. A confirmed keynote invited over email, a
// prospect, and anybody imported from a spreadsheet were unreachable: no control in the
// product would put work on them. The bulk button stays, because a three-task checklist to
// the accepted cohort in one press is the right shortcut; this is the other half.
//
// `Popover` + `Command` + `Badge`, which is the mapping .claude/rules/ui-shadcn.md gives for
// a multi-select over a searchable list, and the same composition `AddItemsPicker` uses on
// the portals surface.
//
// THE ROSTER IS READ WHEN THE PICKER OPENS, not passed down as a page prop. Most visits to
// the Tasks page never open this drawer, and an event's whole speaker list in the page
// payload to fill a control nobody touched is the payload discipline BUILD_SPEC 6.3 scores.
// Read once and kept, so reopening the popover does not re-fetch.
//
// The accepted-session count on each row is not decoration. A SUBMISSIONS task assigned to
// somebody with no accepted session writes nothing at all - `planFanout` refuses to invent a
// row with an empty submission link - so the count is what lets an organizer see that before
// pressing Create, and the warning below says it in words.
//
// Copy is authored. docs/parity/portal-tasks-forms.md lists this whole drawer under
// Ambiguities (ref 25 shows the menu item and never what it opens), so there is nothing
// captured to transcribe here.

import { CheckIcon, UserPlusIcon, XIcon } from 'lucide-react'
import { useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { TaskEntityType } from '@/constants/status'
import { listAssignableSpeakersAction } from '@/features/tasks/actions'
import type { AssignableSpeaker } from '@/features/tasks/roster-scope'

export type AssignSpeakersFieldProps = {
  eventId: string
  /** The chosen record ids, owned by the drawer so Create can send them. */
  value: readonly string[]
  onChange: (speakerIds: readonly string[]) => void
  /** The draft's Type card, which decides whether a chosen speaker can be reached at all. */
  entityType: TaskEntityType
  disabled?: boolean
}

export function AssignSpeakersField({
  eventId,
  value,
  onChange,
  entityType,
  disabled = false,
}: AssignSpeakersFieldProps) {
  const [open, setOpen] = useState(false)
  const [speakers, setSpeakers] = useState<readonly AssignableSpeaker[] | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [pending, startTransition] = useTransition()

  const load = (next: boolean) => {
    setOpen(next)
    // Once. A second open renders what is already held, so browsing the list does not read
    // the roster again.
    if (!next || speakers !== undefined || pending) return
    startTransition(async () => {
      const result = await listAssignableSpeakersAction({ eventId })
      if (!result.ok) {
        setProblem(result.message)
        return
      }
      setSpeakers(result.speakers)
    })
  }

  const chosen = new Set(value)
  const rows = speakers ?? []
  const selectedRows = rows.filter((row) => chosen.has(row.id))
  // Selected ids whose row has not been loaded yet cannot happen from this control, so a
  // chip list built off the loaded rows is complete by construction.
  const unreachable =
    entityType === 'submission'
      ? selectedRows.filter((row) => row.acceptedSubmissions === 0).length
      : 0

  const toggle = (speakerId: string) =>
    onChange(chosen.has(speakerId) ? value.filter((id) => id !== speakerId) : [...value, speakerId])

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Assign to specific speakers</Label>

      <Popover open={open} onOpenChange={load}>
        <PopoverTrigger
          render={<Button variant="outline" className="justify-start" disabled={disabled} />}
        >
          <UserPlusIcon />
          {value.length === 0 ? 'Choose speakers...' : `${String(value.length)} selected`}
        </PopoverTrigger>

        <PopoverContent className="w-80 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search speakers..." />
            <CommandList>
              <CommandEmpty>
                {pending
                  ? 'Loading the roster...'
                  : (problem ?? 'Nobody is on this event’s roster yet.')}
              </CommandEmpty>
              {rows.map((speaker) => (
                <CommandItem
                  key={speaker.id}
                  value={`${speaker.name} ${speaker.email}`}
                  onSelect={() => toggle(speaker.id)}
                >
                  <CheckIcon className={chosen.has(speaker.id) ? 'size-4' : 'size-4 opacity-0'} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{speaker.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {speaker.email}
                      {speaker.acceptedSubmissions === 0
                        ? ''
                        : ` - ${String(speaker.acceptedSubmissions)} accepted`}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedRows.length === 0 ? null : (
        <div className="flex flex-wrap gap-1.5">
          {selectedRows.map((speaker) => (
            <Badge key={speaker.id} variant="secondary" className="gap-1">
              {speaker.name}
              {/* Removable from the chip as well as from the list: a chosen speaker is
                  visible here, and going back into the popover to find their row again is
                  the long way round. */}
              <Button
                variant="ghost"
                size="icon"
                className="size-4"
                aria-label={`Remove ${speaker.name}`}
                disabled={disabled}
                onClick={() => toggle(speaker.id)}
              >
                <XIcon />
              </Button>
            </Badge>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Assigned as soon as the task is created. Anyone on the roster can be chosen, not only
        accepted speakers.
      </p>

      {unreachable === 0 ? null : (
        // Said before Create rather than reported after it. A Submissions task fans out per
        // accepted session, so for somebody with none it writes no row and the organizer
        // would otherwise get a success for work that reached nobody.
        <p className="text-xs text-destructive">
          {unreachable === 1
            ? '1 of these has no accepted session, so this Submissions task will not reach them. Use a Contacts task instead.'
            : `${String(unreachable)} of these have no accepted session, so this Submissions task will not reach them. Use a Contacts task instead.`}
        </p>
      )}
    </div>
  )
}
