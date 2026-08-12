'use client'

// `Add Contact`: the one-person path into the CRM, beside the bulk one.
//
// The directory's header already carried Dashboard and Import. Import is the BULK path and
// stays it; this is the single-person path that did not exist, so an organizer who has just
// met one speaker no longer has to write a one-row spreadsheet to get them in.
//
// A centred `Dialog` rather than a `Sheet`, per .claude/rules/ui-shadcn.md: the drawer is
// reserved for Preferences and Add Abstract, and this is five fields. The dialog is MOUNTED
// ONLY WHILE OPEN, which is what resets it between uses without an effect syncing props into
// state - the same call `SaveSpeakerListDialog` makes and for the same reason.
//
// It renders nothing at all for a viewer with no admin event, which is a reviewer: creating a
// contact links them to an event, that is a write, and a control that can only be refused is
// worse than no control (`loadAddableEvents` makes the same call for `Add To Event`).
//
// COPY IS AUTHORED. The parity report waives the whole CRM area, so there is nothing to
// transcribe; `Saved successfully` is the one string the parity docs do give for a write.

import { UserPlusIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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
  CONTACT_EMAIL_MAX,
  CONTACT_VALUE_MAX,
  checkNewContact,
  EMPTY_CONTACT_DRAFT,
  type NewContactDraft,
} from '@/features/crm/new-contact'
import { createContactAction } from '@/features/crm/new-contact-actions'
import type { AddableEvent } from '@/features/crm/profile-activity'

export type NewContactButtonProps = {
  /** The caller's `admin` events, named. Nothing renders when this is empty. */
  events: readonly AddableEvent[]
}

export function NewContactButton({ events }: NewContactButtonProps) {
  const [open, setOpen] = useState(false)

  if (events.length === 0) return null

  return (
    <>
      {/* The default variant, not `outline` like Dashboard and Import beside it: this is the
          surface's one forward action and the two it sits next to are ways of looking at what
          is already there. */}
      <Button onClick={() => setOpen(true)}>
        <UserPlusIcon data-icon="inline-start" />
        Add Contact
      </Button>
      {open ? <NewContactDialog events={events} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function NewContactDialog({
  events,
  onClose,
}: {
  events: readonly AddableEvent[]
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  // Seeded in `useState` rather than synced from props: the dialog is mounted only while open,
  // so a fresh open is a fresh mount. The first event is preselected because a Select the
  // organizer has to open to choose the only sensible value is a click that says nothing.
  const [draft, setDraft] = useState<NewContactDraft>(() => ({
    ...EMPTY_CONTACT_DRAFT,
    eventId: events[0]?.id ?? '',
  }))

  const set = (patch: Partial<NewContactDraft>) => setDraft((current) => ({ ...current, ...patch }))

  // The same rule the action re-runs, so Save is disabled with a sentence attached rather than
  // enabled with a refusal waiting behind it. Shown only once the address has been typed in,
  // so an untouched dialog is not scolding.
  const check = checkNewContact(draft)
  const problem = draft.email.trim() === '' || check.ok ? undefined : check.reason

  // `startTransition(async () => ...)`, not the synchronous-scope form: that one returns before
  // scheduling anything, so `pending` is false again in the same tick and `disabled={pending}`
  // below would be decorative, which here means two presses creating two people.
  const save = () => {
    startTransition(async () => {
      const result = await createContactAction(draft)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success('Saved successfully', { description: `${result.name} is in your CRM.` })
      onClose()
      // NO `router.refresh()`, matching `SpeakerStageControl`, `SpeakerTagEditor` and every
      // other admin surface here: the Server Action expired the tags the Airtable client
      // cached under (`invalidate()`), and its own response re-renders this route, which is
      // what puts the new row in the table. A refresh would add a round trip and expire
      // nothing (bodo-conventions.md).
    })
  }

  const eventNames = Object.fromEntries(events.map((event) => [event.id, event.name]))

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add contact</DialogTitle>
          <DialogDescription>
            Creates one speaker record and puts them on the event you pick. Only the email address
            is required: the rest is what they fill in from their portal.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="new-contact-email">Email</Label>
          <Input
            id="new-contact-email"
            type="email"
            value={draft.email}
            maxLength={CONTACT_EMAIL_MAX}
            placeholder="speaker@example.com"
            onChange={(event) => set({ email: event.target.value })}
          />
          {problem === undefined ? null : <p className="text-destructive text-xs">{problem}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-contact-first">First Name</Label>
            <Input
              id="new-contact-first"
              value={draft.firstName}
              maxLength={CONTACT_VALUE_MAX}
              onChange={(event) => set({ firstName: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-contact-last">Last Name</Label>
            <Input
              id="new-contact-last"
              value={draft.lastName}
              maxLength={CONTACT_VALUE_MAX}
              onChange={(event) => set({ lastName: event.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-contact-company">Company</Label>
            <Input
              id="new-contact-company"
              value={draft.company}
              maxLength={CONTACT_VALUE_MAX}
              onChange={(event) => set({ company: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-contact-tagline">Tagline</Label>
            <Input
              id="new-contact-tagline"
              value={draft.tagline}
              maxLength={CONTACT_VALUE_MAX}
              onChange={(event) => set({ tagline: event.target.value })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="new-contact-event">Event</Label>
          {/* `items` is not optional here: Base UI's `Select.Value` prints the RAW value
              without it, so the closed trigger would read a record id. */}
          <Select
            value={draft.eventId}
            items={eventNames}
            onValueChange={(next: string | null) => {
              if (next !== null) set({ eventId: next })
            }}
          >
            <SelectTrigger id="new-contact-event" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {events.map((event) => (
                <SelectItem key={event.id} value={event.id}>
                  {event.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            A contact belongs to the organization, not to one event. This is the roster they join
            now; you can add them to others from their profile.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending || !check.ok} onClick={save}>
            {pending ? 'Adding...' : 'Add contact'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
