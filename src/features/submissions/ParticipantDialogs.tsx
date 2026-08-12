'use client'

// The two dialogs behind the organizer's Participants panel: add somebody by email, and
// point an existing row at a different Speakers record.
//
// Split from ./SubmissionParticipantsPanel.tsx for the file-size rule, and they sit
// together because they are the same decision seen twice: WHO is on this session.
//
// The Change speaker picker is a `Command` list and not a `Select`, and that is the control
// the defect actually needs. The event's Speakers table holds four rows reading "Priya
// Raman"; a dropdown of names is unusable there, so every entry carries the email address
// that distinguishes them and the list is searchable. .claude/rules/ui-shadcn.md maps
// "searchable field picker" to `Command`.

import { CheckIcon } from 'lucide-react'
import { useState } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  addSubmissionParticipantAction,
  reassignSubmissionParticipantAction,
} from '@/features/submissions/roster-actions'
import type { AdminRosterRow, RosterCandidate } from '@/features/submissions/roster-admin-view'
import { useRosterAction } from '@/features/submissions/use-roster-action'

export type RoleOption = { role: string; label: string }

/** The ids both dialogs post, so neither can address the wrong record. */
export type RosterTarget = { eventId: string; submissionId: string }

export function AddParticipantDialog({
  target,
  roles,
  open,
  onOpenChange,
}: {
  target: RosterTarget
  roles: readonly RoleOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { pending, run } = useRosterAction()
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [role, setRole] = useState<string | null>(roles.at(0)?.role ?? null)

  function submit(): void {
    const formData = new FormData()
    formData.set('eventId', target.eventId)
    formData.set('submissionId', target.submissionId)
    formData.set('email', email)
    formData.set('firstName', firstName)
    formData.set('lastName', lastName)
    formData.set('role', role ?? '')
    run(addSubmissionParticipantAction, formData, () => {
      onOpenChange(false)
      setEmail('')
      setFirstName('')
      setLastName('')
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a participant</DialogTitle>
          <DialogDescription>
            They are added by email address. If they already have a speaker profile it is reused,
            and they can sign in with that address to see this session.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field id="admin-participant-email" label="Email">
            <Input
              id="admin-participant-email"
              type="email"
              value={email}
              placeholder="name@example.com"
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="admin-participant-first" label="First Name">
              <Input
                id="admin-participant-first"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </Field>
            <Field id="admin-participant-last" label="Last Name">
              <Input
                id="admin-participant-last"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </Field>
          </div>
          <Field id="admin-participant-role" label="Role">
            <Select
              // Base UI prints the STORED value on the closed trigger unless it is handed
              // the label for it, so without this map the trigger reads `co_speaker`. Same
              // fix, same reason, as the speaker Select in `agenda/list/AddSessionSheet`.
              items={Object.fromEntries(roles.map((option) => [option.role, option.label]))}
              value={role}
              onValueChange={(next: string | null) => setRole(next)}
            >
              <SelectTrigger id="admin-participant-role" className="w-full">
                <SelectValue placeholder="Select role..." />
              </SelectTrigger>
              <SelectContent>
                {roles.map((option) => (
                  <SelectItem key={option.role} value={option.role}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={pending || email.trim() === ''} onClick={submit}>
            {pending ? 'Adding...' : 'Add participant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ChangeSpeakerDialog({
  target,
  row,
  candidates,
  open,
  onOpenChange,
}: {
  target: RosterTarget
  row: AdminRosterRow
  /** Everyone on the event. Already filtered of the people on this session by the caller. */
  candidates: readonly RosterCandidate[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { pending, run } = useRosterAction()

  function pick(speakerId: string): void {
    const formData = new FormData()
    formData.set('eventId', target.eventId)
    formData.set('submissionId', target.submissionId)
    formData.set('participantId', row.id)
    formData.set('speakerId', speakerId)
    run(reassignSubmissionParticipantAction, formData, () => {
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change speaker</DialogTitle>
          <DialogDescription>
            {row.isPrimary
              ? `${row.name} is the submitter of this session. The person you pick takes their place on it, and receives the decision email.`
              : `${row.name} is taken off this session and the person you pick takes their place, keeping the ${row.roleLabel} role.`}
          </DialogDescription>
        </DialogHeader>

        <Command>
          <CommandInput placeholder="Search speakers..." />
          <CommandList>
            <CommandEmpty>No speakers found.</CommandEmpty>
            {candidates.map((candidate) => (
              <CommandItem
                key={candidate.id}
                // Name AND email, because the search has to be able to tell four people
                // called "Priya Raman" apart, which is the case this whole control exists
                // for.
                value={`${candidate.name} ${candidate.email}`}
                disabled={pending}
                onSelect={() => {
                  pick(candidate.id)
                }}
              >
                <Avatar size="sm">
                  {candidate.headshotUrl === undefined ? null : (
                    <AvatarImage src={candidate.headshotUrl} alt="" />
                  )}
                  <AvatarFallback>{candidate.initials}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 truncate">{candidate.name}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">
                  {candidate.email}
                </span>
                {candidate.id === row.speakerId ? <CheckIcon className="size-4" /> : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}
