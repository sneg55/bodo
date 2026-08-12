'use client'

// The six inputs on the Add Speaker sheet. Split from `AddSpeakerSheet.tsx` for the file-size
// limit; the sheet keeps the confirmation, the action call and the footer.
//
// SIX FIELDS, and which six is the whole design. It was four - Name, Email, Company, Status -
// on the argument that everything else belongs to the speaker or can be added afterwards.
// That argument was right about the logistics and wrong about the PROFILE: an organizer
// adding a confirmed speaker by hand is copying an email that already carries their job title
// and their bio, and a create form that refuses both makes them save, reopen the row in the
// edit sheet, and paste the same two values a second time.
//
// What is deliberately NOT here:
//
//   - Dietary requirements and Travel notes. Those are logistics, they arrive after somebody
//     has accepted, and they are the fields the edit sheet is for.
//   - The headshot. `/api/files/upload` writes `Speakers.headshotUrl` against a record id,
//     and on this sheet there is no record yet. See SpeakerHeadshotField.tsx.
//   - Pronouns, gender, phone, the social links. The speaker's own, maintained in their
//     portal; an organizer filling them in on somebody's behalf is guessing.

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SPEAKER_STATUSES, speakerStatusLabel } from '@/constants/status'
import type { AddSpeakerFormValues, KnownSpeaker } from '@/features/speakers/add-speaker-form'

const STATUS_ITEMS = SPEAKER_STATUSES.map((value) => ({
  value,
  label: speakerStatusLabel(value),
}))

export function AddSpeakerFields({
  values,
  onChange,
  known,
}: {
  values: AddSpeakerFormValues
  /** A patch, so a caller never has to restate the six fields it is not changing. */
  onChange: (patch: Partial<AddSpeakerFormValues>) => void
  /** Set once the address has been resolved onto somebody, which changes two hints. */
  known: KnownSpeaker | undefined
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="add-speaker-name">Name</Label>
        <Input
          id="add-speaker-name"
          value={values.name}
          placeholder="Ada Okafor"
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="add-speaker-email">Email</Label>
        <Input
          id="add-speaker-email"
          type="email"
          value={values.email}
          placeholder="name@example.com"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => onChange({ email: event.target.value })}
        />
        {/* The address is the identity every other row links on, and it is the one thing here
            that cannot be corrected from this sheet afterwards: the edit sheet refuses to
            take it, because accepting one there would let an organizer point a speaker record
            at somebody else's account. */}
        <p className="text-pretty text-xs text-muted-foreground">
          This is how they sign in, and it cannot be changed here later.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="add-speaker-company">Company</Label>
        <Input
          id="add-speaker-company"
          value={values.company}
          onChange={(event) => onChange({ company: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="add-speaker-tagline">Tagline</Label>
        <Input
          id="add-speaker-tagline"
          value={values.tagline}
          placeholder="Head of Platform Engineering"
          onChange={(event) => onChange({ tagline: event.target.value })}
        />
        {/* The job title, and the reason this field is on the create form at all: it is the
            line that renders under a speaker's name everywhere they appear. */}
        <p className="text-pretty text-xs text-muted-foreground">
          Shown under their name on the agenda and the speaker card.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="add-speaker-status">Status</Label>
        <Select
          items={STATUS_ITEMS}
          value={values.status}
          onValueChange={(next: string | null) => {
            const found = SPEAKER_STATUSES.find((value) => value === next)
            // `statusTouched` moves with the value and never on its own: it is the record of
            // a deliberate choice, and the submit sends the field only when it is set.
            if (found !== undefined) onChange({ status: found, statusTouched: true })
          }}
        >
          <SelectTrigger id="add-speaker-status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-pretty text-xs text-muted-foreground">
          {known === undefined
            ? 'Where they are in your process. New speakers start as Prospect.'
            : `Left alone unless you pick one. ${known.name} is ${speakerStatusLabel(known.status)}.`}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="add-speaker-bio">Biography</Label>
        <Textarea
          id="add-speaker-bio"
          value={values.bioText}
          rows={6}
          placeholder="Ada builds..."
          onChange={(event) => onChange({ bioText: event.target.value })}
        />
        {/* The speaker's own editor is TipTap with a 5,000 character counter; this is the same
            cap, enforced in the action rather than counted down here, because an organizer
            pasting a bio out of an email is not composing against a limit. */}
        <p className="text-pretty text-xs text-muted-foreground">
          Up to 5,000 characters. Blank leaves whatever the speaker has already written.
        </p>
      </div>
    </>
  )
}
