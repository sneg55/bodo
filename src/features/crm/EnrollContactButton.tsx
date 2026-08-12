'use client'

// `Enroll Contact`: the way a contact gets PUT into a sourcing stage.
//
// THE GAP THIS CLOSES. The board moved cards and the moves survived a reload, but an agent
// enumerating every button and link on it found no enroll, add-prospect or add-card action:
// each contact is auto-placed into Prospect by `displayStage`, so the board could only ever
// re-file people who were already drawn on it. Being shown in a column by default is not an
// organizer having decided somebody belongs there.
//
// A centred `Dialog`, because there are three decisions here (who, which stage, and whether to
// say why) and a `DropdownMenu` cannot hold a search box, a select and a text field. The
// contact picker is `Command` inside the dialog rather than behind its own `Popover`: the
// mapping in .claude/rules/ui-shadcn.md gives `Command` for a searchable picker, and an
// overlay opened from inside an overlay is a focus trap inside a focus trap for no gain.
//
// SCORE AND RATIONALE ARE OPTIONAL and both become one attributed note rather than new
// columns; `enroll.ts` carries that argument. Enrolling with neither writes only the move.
//
// COPY IS AUTHORED. The parity report waives the whole CRM area, so there is nothing to
// transcribe; the stage names are `SPEAKER_STATUS_LABELS` verbatim, which is what the column
// headings above the board already draw, and `Saved successfully` is the one string the parity
// docs do give for a write.

import { CheckIcon, UserPlusIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SPEAKER_STATUSES, type SpeakerStatus, speakerStatusLabel } from '@/constants/status'
import { ENROLL_SCORES, NO_SCORE, RATIONALE_MAX } from '@/features/crm/enroll'
import { enrollContactAction } from '@/features/crm/enroll-actions'
import type { EnrollableContact } from '@/features/crm/pipeline'

/** Where a newly enrolled contact goes unless the organizer says otherwise. */
const DEFAULT_STAGE: SpeakerStatus = 'prospect'

export type EnrollContactButtonProps = {
  /** Everyone the viewer may move. Nothing renders when this is empty, which is a reviewer. */
  contacts: readonly EnrollableContact[]
}

export function EnrollContactButton({ contacts }: EnrollContactButtonProps) {
  const [open, setOpen] = useState(false)

  if (contacts.length === 0) return null

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlusIcon data-icon="inline-start" />
        Enroll Contact
      </Button>
      {/* Mounted only while open, so every field resets on a fresh open without an effect
          syncing props into state. The call `SaveSpeakerListDialog` makes, for its reason. */}
      {open ? <EnrollDialog contacts={contacts} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

const STAGE_LABELS = Object.fromEntries(
  SPEAKER_STATUSES.map((status) => [status, speakerStatusLabel(status)]),
)

const NO_SCORE_LABEL = 'Not scored'

const scoreLabel = (score: number): string => `${String(score)} of 5`

const SCORE_LABELS: Record<string, string> = Object.fromEntries([
  [NO_SCORE, NO_SCORE_LABEL] as const,
  ...ENROLL_SCORES.map((score) => [String(score), scoreLabel(score)] as const),
])

function EnrollDialog({
  contacts,
  onClose,
}: {
  contacts: readonly EnrollableContact[]
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [speakerId, setSpeakerId] = useState('')
  const [stage, setStage] = useState<SpeakerStatus>(DEFAULT_STAGE)
  const [score, setScore] = useState<string>(NO_SCORE)
  const [rationale, setRationale] = useState('')

  const picked = contacts.find((contact) => contact.id === speakerId)

  // `startTransition(async () => ...)` and not the synchronous-scope form: that one returns
  // before scheduling anything, so `pending` is false again in the same tick and every
  // `disabled={pending}` below would be decorative, which here is two enrollments and two
  // history rows disagreeing about the previous stage.
  const enroll = () => {
    if (picked === undefined) return
    startTransition(async () => {
      const result = await enrollContactAction({
        speakerId: picked.id,
        status: stage,
        ...(score === NO_SCORE ? {} : { score: Number(score) }),
        ...(rationale.trim() === '' ? {} : { rationale }),
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      // Two different true things. `moved: false` is the contact already sitting on that
      // stage, and saying "Saved successfully" for it would claim a write that did not happen.
      toast.success(result.moved ? 'Saved successfully' : 'Already on that stage', {
        description: `${picked.name} is in ${speakerStatusLabel(stage)}.`,
      })
      onClose()
    })
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enroll a contact</DialogTitle>
          <DialogDescription>
            Puts somebody from your directory into a sourcing stage and records the move on their
            profile.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label>Contact</Label>
          <Command className="rounded-md border">
            <CommandInput placeholder="Search contacts..." />
            <CommandList className="max-h-56">
              <CommandEmpty>No contacts found.</CommandEmpty>
              {contacts.map((contact) => (
                <CommandItem
                  key={contact.id}
                  value={`${contact.name} ${contact.subtitle}`}
                  onSelect={() => setSpeakerId(contact.id)}
                >
                  <CheckIcon className={contact.id === speakerId ? 'size-4' : 'size-4 opacity-0'} />
                  <span className="min-w-0 flex-1 truncate">{contact.name}</span>
                  <span className="min-w-0 truncate text-muted-foreground text-xs">
                    {contact.subtitle}
                  </span>
                  {/* Where they are FILED now, so enrolling somebody into the stage they are
                      already in is a visible no-op rather than a surprise toast. */}
                  <Badge variant="outline" className="shrink-0">
                    {speakerStatusLabel(contact.stage)}
                  </Badge>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="enroll-stage">Stage</Label>
            {/* `items` is not optional: Base UI's `Select.Value` prints the raw value without
                it, so the closed trigger would read `prospect` rather than `Prospect`. */}
            <Select
              value={stage}
              items={STAGE_LABELS}
              onValueChange={(next: string | null) => {
                if (next !== null) setStage(next as SpeakerStatus)
              }}
            >
              <SelectTrigger id="enroll-stage" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPEAKER_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {speakerStatusLabel(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="enroll-score">Fit score (optional)</Label>
            <Select
              value={score}
              items={SCORE_LABELS}
              onValueChange={(next: string | null) => {
                if (next !== null) setScore(next)
              }}
            >
              <SelectTrigger id="enroll-score" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SCORE}>{NO_SCORE_LABEL}</SelectItem>
                {ENROLL_SCORES.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {scoreLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="enroll-rationale">Rationale (optional)</Label>
          <Textarea
            id="enroll-rationale"
            value={rationale}
            maxLength={RATIONALE_MAX}
            rows={3}
            placeholder="Why this speaker, for whoever reads the profile next..."
            onChange={(event) => setRationale(event.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            The score and the rationale are saved as a note on the contact, attributed to you.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending || picked === undefined} onClick={enroll}>
            {pending ? 'Enrolling...' : 'Enroll'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
