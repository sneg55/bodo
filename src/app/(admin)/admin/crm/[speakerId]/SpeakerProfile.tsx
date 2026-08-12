'use client'

// One speaker's profile: header, four tabs, and the controls that write.
//
// A client component because the tab strip is: `Tabs` is a Base UI primitive, and switching
// between Details and Communication must not cost a round trip. Everything it receives is
// already resolved and already formatted, including the timestamps, which are rendered on
// the server for the reason `features/review/date-text.ts` records.
//
// The `Tabs` root wraps the header as well as the panels, because the strip lives in
// `PageHeader`'s `below` slot and a trigger has to sit inside the same root as its panel.
//
// THE WRITES ON THIS PAGE, and none of them turns the read-only cards below into inputs:
//
//   - The Speaker Tags card is `SpeakerTagEditor`, which lives in `src/features/crm` with the
//     rest of the CRM's logic. It is here rather than on a surface of its own because a tag
//     is a fact about a person and this is the person's page.
//   - The stage is `SpeakerStageControl`, the SAME Move-to menu the pipeline board's cards
//     carry, so the two surfaces cannot drift on what a move does or on who may make one. It
//     is in the header rather than on a tab because the stage is the headline fact about a
//     contact, and because the board an organizer arrives from puts it there too.
//   - `Add To Event` is `AddToEventButton`, the outward half of CRM-10: the event-side ADD
//     SPEAKER sheet already linked an existing CRM record rather than duplicating it, and
//     this is the path from the contact TO an event, so a name and an address never have to
//     be re-keyed.
//   - Internal Notes is on the Notes and Activity tab, with the stage history beside it.
//   - Edit opens `SpeakerEditSheet`, the SAME sheet the event roster's row action opens. One
//     editor means the two surfaces cannot drift on which fields an organizer owns, and that
//     boundary is argued at length in the sheet's own header: pronouns, gender, phone and the
//     social links stay the speaker's, maintained in their portal, so the General card still
//     shows fields the sheet will not offer.
//
// The stage and the note writes need no event id at all, because they are org-level; Edit
// and Add To Event do. This page has no id in its path, so the server picks one:
// `view.editableEventId` is the first of the speaker's in-scope events the viewer holds
// `admin` on, and it is ABSENT for a reviewer, which is what removes those controls. See
// `editableEventId` in `features/crm/profile.ts`. Absent is a rendering answer only; every
// action re-derives the whole thing for itself.
//
// `router.refresh()` on save from the EDIT SHEET only, where the roster patches its row in
// place instead. Everything else here writes through a Server Action called inside a
// transition, whose own response re-renders this route: the write has already expired the
// tags the Airtable client cached under, so a refresh would add a round trip and expire
// nothing. See `SpeakerTagEditor`.
//
// The panels live beside this file: `SpeakerDetailsTab.tsx`, `SpeakerActivityTab.tsx`, and
// the Events/Communication pair plus the shared `Field` renderer in
// `SpeakerProfilePanels.tsx`. This file was at its size budget with one panel inlined.
//
// COPY IS AUTHORED. The parity report waives the whole CRM area, so there is nothing to
// transcribe; the field labels are the exceptions and are noted in `SpeakerDetailsTab.tsx`.

import { ArrowLeftIcon, PencilIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { PageHeader } from '@/components/primitives/PageHeader'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AddToEventButton } from '@/features/crm/AddToEventButton'
import type { SpeakerProfileView } from '@/features/crm/profile'
import { SpeakerStageControl } from '@/features/crm/SpeakerStageControl'
import { speakerInitials, speakerName } from '@/features/crm/speaker-rows'
import { editableFromSpeaker } from '@/features/speakers/editable-speaker'
import { SpeakerEditSheet } from '@/features/speakers/SpeakerEditSheet'
import type { Speaker } from '@/types/domain'

import { SpeakerActivityTab } from './SpeakerActivityTab'
import { SpeakerDetailsTab } from './SpeakerDetailsTab'
import { CommunicationTab, SessionsTab } from './SpeakerProfilePanels'

export function SpeakerProfile({ view }: { view: SpeakerProfileView }) {
  const {
    speaker,
    tags,
    vocabulary,
    events,
    sessionCount,
    timeline,
    activity,
    logistics,
    addableEvents,
    editableEventId,
  } = view
  const router = useRouter()
  const [editing, setEditing] = useState(false)

  // The one capability question the panels ask, answered once. It is the same answer
  // `editableEventId` gives, named for what it means on this page rather than for the event
  // id it happens to be: a viewer who holds `admin` on none of this contact's events is a
  // reviewer, and every write on this page is absent for them.
  const canWrite = editableEventId !== undefined

  return (
    <Tabs defaultValue="details">
      <PageHeader
        leading={
          <ButtonLink href="/admin/crm" variant="ghost" size="icon" aria-label="Back">
            <ArrowLeftIcon />
          </ButtonLink>
        }
        iconSlot={
          /* `after:rounded-none` as well as `rounded-none`: `Avatar` draws its border as a
             `::after` overlay carrying its own `after:rounded-full`, and twMerge treats
             `rounded` and `after:rounded` as different keys, so overriding one left a
             circular ring drawn over a square tile. */
          <Avatar className="size-9 rounded-none after:rounded-none">
            <AvatarImage src={speaker.headshotUrl} alt="" />
            <AvatarFallback className="rounded-none bg-transparent text-xs text-primary">
              {speakerInitials(speaker)}
            </AvatarFallback>
          </Avatar>
        }
        title={speakerName(speaker)}
        description={subtitle(speaker)}
        actions={
          // Absent for a viewer who holds `admin` on none of this speaker's events, which
          // is a reviewer. Rendering them disabled would be worse: it would advertise
          // writes that are not theirs and say nothing about why.
          canWrite ? (
            <>
              <SpeakerStageControl speakerId={speaker.id} stage={speaker.status} />
              <AddToEventButton speakerId={speaker.id} events={addableEvents} />
              <Button variant="outline" onClick={() => setEditing(true)}>
                <PencilIcon />
                Edit
              </Button>
            </>
          ) : undefined
        }
        below={
          <TabsList variant="line">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="sessions">{`Events and Sessions (${String(sessionCount)})`}</TabsTrigger>
            <TabsTrigger value="activity">{`Notes and Activity (${String(activity.notes.length)})`}</TabsTrigger>
            <TabsTrigger value="communication">{`Communication (${String(timeline.length)})`}</TabsTrigger>
          </TabsList>
        }
      />

      <TabsContent value="details" className="flex flex-col gap-4 pt-4">
        <SpeakerDetailsTab
          speaker={speaker}
          tags={tags}
          vocabulary={vocabulary}
          logistics={logistics}
          invitedAtText={view.invitedAtText}
        />
      </TabsContent>

      <TabsContent value="sessions" className="flex flex-col gap-4 pt-4">
        <SessionsTab events={events} />
      </TabsContent>

      <TabsContent value="activity" className="flex flex-col gap-4 pt-4">
        <SpeakerActivityTab speakerId={speaker.id} activity={activity} canWrite={canWrite} />
      </TabsContent>

      <TabsContent value="communication" className="flex flex-col gap-4 pt-4">
        <CommunicationTab timeline={timeline} />
      </TabsContent>

      {/* Outside every `TabsContent`, so switching tabs underneath an open sheet does not
          unmount the form and lose what has been typed into it. */}
      {editableEventId === undefined ? null : (
        <SpeakerEditSheet
          eventId={editableEventId}
          speaker={editing ? editableFromSpeaker(speaker) : undefined}
          onOpenChange={(open) => {
            if (!open) setEditing(false)
          }}
          onSaved={() => {
            setEditing(false)
            toast.success('Saved successfully')
            router.refresh()
          }}
        />
      )}
    </Tabs>
  )
}

/**
 * The one line under the name: the tagline if they wrote one, otherwise the company,
 * otherwise the email. The same fallback order the directory's search box scans in.
 */
function subtitle(speaker: Speaker): string {
  return speaker.tagline ?? speaker.company ?? speaker.email
}
