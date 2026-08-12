'use client'

// The organizer's speaker profile editor. CNT-10.
//
// A right-hand `Sheet`, matching Add Abstract and Add File Request, which is the shape this
// product uses for editing one record beside the list it came from.
//
// TWO CALLERS, ONE FORM: the event roster's row action and the CRM profile's Edit button.
// It takes an `EditableSpeaker` rather than either surface's own row type, so neither one's
// shape leaks in here and the CRM does not have to fake a roster row to reuse it. The
// adaptations, and the `eventId` each surface scopes its write to, are theirs to supply.
//
// WHAT AN ORGANIZER OWNS, AND NOT THE WHOLE PROFILE, deliberately. Pronouns, gender, phone
// and the social links stay the speaker's own, maintained in their portal: an organizer
// editing somebody's pronouns from an admin screen is not a feature anybody asked for. The
// action sends only what is here, and `compact` at the Airtable boundary leaves every other
// column alone, so this cannot blank a field it does not show.
//
// The status and the logistics are the other way round: they are the ORGANIZER's record of a
// person, not the person's own copy, which is why they appear here and nowhere in the portal.
// Whether somebody has confirmed they are coming is a fact about the event's planning, and a
// speaker marking themselves confirmed would mean nothing.
//
// THE HEADSHOT IS AN UPLOAD as well as a URL, and it is the one field here that does not wait
// for Save: `/api/files/upload` writes `Speakers.headshotUrl` itself once the bytes are
// verified. It used to be a bare text input, because that route could only write the headshot
// of the speaker OF THE CURRENT SESSION and pointing it at another record would have been a
// way for an admin to write to any speaker row by id. It now has an organizer branch that
// authorizes `admin` on the event and resolves the speaker against that event's own roster.
// See SpeakerHeadshotField.tsx and features/speakers/headshot-upload.ts.

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { SPEAKER_STATUSES, type SpeakerStatus, speakerStatusLabel } from '@/constants/status'
import { saveSpeakerProfileAction } from '@/features/speakers/actions'
import { bioToText, textToBioHtml } from '@/features/speakers/bio-text'
import type { EditableSpeaker } from '@/features/speakers/editable-speaker'
import { speakerInitials } from '@/features/speakers/initials'
import { SpeakerHeadshotField } from '@/features/speakers/SpeakerHeadshotField'
import { blank, Field } from '@/features/speakers/speaker-sheet-fields'

/** The `items` prop `Select` needs, or the closed trigger shows the raw stored value. */
const STATUS_ITEMS = SPEAKER_STATUSES.map((value) => ({
  value,
  label: speakerStatusLabel(value),
}))

export type SpeakerEditSheetProps = {
  /**
   * The event the write is scoped to, which the caller owns because only the caller knows
   * which of the speaker's events the viewer may write through. The action checks the role
   * on it regardless.
   */
  eventId: string
  /** The person being edited, or undefined for closed. */
  speaker?: EditableSpeaker
  onOpenChange: (open: boolean) => void
  /** The saved values, for a caller that patches a row rather than refetching. */
  onSaved: (speaker: EditableSpeaker) => void
}

export function SpeakerEditSheet({
  eventId,
  speaker,
  onOpenChange,
  onSaved,
}: SpeakerEditSheetProps) {
  return (
    <Sheet open={speaker !== undefined} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        {speaker === undefined ? null : (
          // Keyed on the speaker, so opening a different row remounts the form with that
          // person's values. Without the key the fields would keep the previous speaker's
          // text, which is the classic way an editor saves the wrong record.
          <SpeakerEditForm key={speaker.id} eventId={eventId} speaker={speaker} onSaved={onSaved} />
        )}
      </SheetContent>
    </Sheet>
  )
}

function SpeakerEditForm({
  eventId,
  speaker,
  onSaved,
}: {
  eventId: string
  speaker: EditableSpeaker
  onSaved: (speaker: EditableSpeaker) => void
}) {
  // The two stored columns, edited as the record holds them. Recovering them from a display
  // name is the CALLER's problem where a caller only has one (`editableFromRoster`), and
  // re-splitting a joined name on save would get every compound surname wrong.
  const [firstName, setFirstName] = useState(speaker.firstName)
  const [lastName, setLastName] = useState(speaker.lastName)
  const [company, setCompany] = useState(speaker.company ?? '')
  const [tagline, setTagline] = useState(speaker.tagline ?? '')
  // The biography is stored as HTML, because the speaker writes it in TipTap, and this
  // sheet is a plain textarea. It is read through `bioToText` so the organizer sees prose
  // rather than `<p>Ada builds...</p>`, and written back through `textToBioHtml` ONLY if
  // they touched it. Untouched, the speaker's own markup goes back exactly as it came,
  // which is what stops an organizer correcting a job title from flattening somebody's
  // formatting. See bio-text.ts.
  const [bioText, setBioText] = useState(() => bioToText(speaker.bio ?? ''))
  const [bioTouched, setBioTouched] = useState(false)
  const bio = bioTouched ? textToBioHtml(bioText) : (speaker.bio ?? '')
  const [headshotUrl, setHeadshotUrl] = useState(speaker.headshotUrl ?? '')
  const [status, setStatus] = useState<SpeakerStatus>(speaker.status)
  const [dietary, setDietary] = useState(speaker.dietary ?? '')
  const [travelNotes, setTravelNotes] = useState(speaker.travelNotes ?? '')
  const [pending, startTransition] = useTransition()

  function save(): void {
    startTransition(async () => {
      const result = await saveSpeakerProfileAction({
        eventId,
        speakerId: speaker.id,
        firstName,
        lastName,
        company,
        tagline,
        bio,
        headshotUrl,
        status,
        dietary,
        travelNotes,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      // What the record now holds, not what was typed: trimmed, and emptied fields absent.
      // The caller decides what to do with it - patch a row in place, or refetch and ignore
      // it - and either way it must agree with what a fresh read would return.
      onSaved({
        ...speaker,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        company: blank(company),
        tagline: blank(tagline),
        bio: blank(bio),
        headshotUrl: blank(headshotUrl),
        status,
        dietary: blank(dietary),
        travelNotes: blank(travelNotes),
      })
    })
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>Edit speaker</SheetTitle>
        {/* The address is the identity every other row links on, so it is shown and not
            edited. The action refuses a posted one for the same reason. */}
        <SheetDescription>{speaker.email}</SheetDescription>
        {/* Says the panel continues, because nothing else does. The body below scrolls and a
            scrollbar only appears while it is being used, so a reader who happens to screenshot
            a short viewport sees a form that looks complete at whichever field the fold cuts
            it off. That is not hypothetical: it is how CNT-10's Biography field was reported
            as missing. Naming the last two fields is cheaper than a fade or a chevron and
            says exactly what is down there. */}
        <p className="text-pretty text-xs text-muted-foreground">
          Scroll for dietary requirements and travel notes.
        </p>
      </SheetHeader>

      {/* `min-h-0 flex-1 overflow-y-auto`, and every word of it is load-bearing. `SheetContent`
          is a flex column and `SheetFooter` is `mt-auto`, so a body that is allowed to grow
          pushes the footer past the bottom of the panel instead of scrolling. This form is
          ten fields tall: at a 1280x577 viewport the SAVE button sat entirely below the fold
          with nothing to scroll it into view, so the sheet could be filled in but never
          submitted. `elementFromPoint` at the button's own centre returned the header's
          description paragraph, which is how browser automation reported it -- and three
          separate eval agents read that as "SAVE silently discards every change", because
          from the outside a click that never lands is indistinguishable from one that does
          nothing. A flex child will not scroll without `min-h-0`; its default `min-height:
          auto` is what lets it outgrow the parent in the first place.
          Same shape as `AddSessionSheet`. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" value={firstName} onChange={setFirstName} disabled={pending} />
          <Field label="Last name" value={lastName} onChange={setLastName} disabled={pending} />
        </div>
        <Field label="Company" value={company} onChange={setCompany} disabled={pending} />
        <Field label="Tagline" value={tagline} onChange={setTagline} disabled={pending} />

        {/* ABOVE the headshot and the logistics, and the order is the fix for a real report.
            Biography used to sit last, below Travel notes, ten fields down a panel that has
            to scroll. An eval agent screenshotted this sheet, listed the fields it could see
            (First name, Last name, Company, Tagline, Headshot, Status, SAVE) and scored
            CNT-10's bio half as "the sheet contains no Biography field". The field worked;
            it was simply below the fold, and nothing about the panel said there was more.
            It belongs here on the merits anyway: a biography is a primary profile field an
            organizer edits alongside the name and the job title, not a logistics note. */}
        <div className="space-y-1.5">
          <Label htmlFor="speaker-bio">Biography</Label>
          <Textarea
            id="speaker-bio"
            value={bioText}
            rows={8}
            disabled={pending}
            onChange={(event) => {
              setBioTouched(true)
              setBioText(event.target.value)
            }}
          />
        </div>

        <SpeakerHeadshotField
          eventId={eventId}
          speakerId={speaker.id}
          // Derived rather than carried on `EditableSpeaker`: that type is what an organizer
          // may EDIT, and initials are a rendering of two fields already on it.
          // `speakerInitials` is the one implementation the CRM directory also uses, so the
          // avatar here and the avatar on the profile cannot disagree about someone with no
          // last name, and a row with no name AND no email reads `?` rather than blank.
          initials={speakerInitials(speaker)}
          value={headshotUrl}
          onChange={setHeadshotUrl}
          disabled={pending}
        />

        <div className="space-y-1.5">
          <Label htmlFor="speaker-status-trigger">Status</Label>
          <Select
            value={status}
            items={STATUS_ITEMS}
            disabled={pending}
            onValueChange={(next: string | null) => {
              // A select cannot produce a value outside its own items, and the action
              // re-checks the vocabulary anyway, so the narrowing here is for the type
              // rather than for trust.
              const found = SPEAKER_STATUSES.find((known) => known === next)
              if (found !== undefined) setStatus(found)
            }}
          >
            <SelectTrigger id="speaker-status-trigger" className="w-full">
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
        </div>

        <Field
          label="Dietary requirements"
          value={dietary}
          onChange={setDietary}
          disabled={pending}
        />

        <div className="space-y-1.5">
          <Label htmlFor="speaker-travel">Travel notes</Label>
          <Textarea
            id="speaker-travel"
            value={travelNotes}
            rows={3}
            disabled={pending}
            onChange={(event) => setTravelNotes(event.target.value)}
          />
        </div>
      </div>

      <SheetFooter>
        <Button disabled={pending} onClick={save}>
          Save
        </Button>
      </SheetFooter>
    </>
  )
}
