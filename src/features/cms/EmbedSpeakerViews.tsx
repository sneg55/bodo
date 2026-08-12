// The two roster views, and the Speaker card's Field Options applied to them.
//
// Split out of EmbedViews.tsx to keep both inside the file-size budget. The layouts are AUTHORED
// for the reason that file's header gives: ref 33 shows no speaker view at all, so these borrow the
// public agenda's own visual language rather than inventing a second one.
//
// Field Options: "Grey fields are required; blue fields are preselected and customizable." On this
// card only `name` is grey, because a roster of headshots with no names is not a roster. The other
// four are read off the `fields` set the projection resolved (@/features/cms/field-options), so
// deselecting one removes it from the rendered output here rather than merely from the panel.
//
// What is NOT here, and deliberately: email, phone and postal address. Those are private and not
// selectable at any tier. The BIOGRAPHY was on that list for a different reason, that no view
// rendered it, and it now appears in the detail a card opens; field-options.ts records that
// reversal next to the reasoning for every field still excluded.
//
// Both cards are the trigger of `EmbedSpeakerDetail`, so the whole card is the hit area rather
// than a link buried inside it. The cards stay server components and only the dialog wrapper is a
// client one, so nothing about how the roster was projected ships to the browser.

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { EmbedSpeakerItem, EmbedSpeakerSearch } from '@/features/cms/EmbedSpeakerBrowse'
import { EmbedSpeakerDetail } from '@/features/cms/EmbedSpeakerDetail'
import { EmbedSpeakerSessions } from '@/features/cms/EmbedSpeakerSessions'
import type { EmbedSpeaker } from '@/features/cms/speakers'

export type EmbedFieldSet = ReadonlySet<string>

type RosterProps = { speakers: readonly EmbedSpeaker[]; fields: EmbedFieldSet }

export function EmbedSpeakerListView({ speakers, fields }: RosterProps) {
  return (
    <div className="flex flex-col">
      <EmbedSpeakerSearch speakers={speakers.map(searchable)} />
      <div className="flex flex-col gap-2">
        {speakers.map((speaker) => (
          <EmbedSpeakerItem key={speaker.id} speaker={searchable(speaker)}>
            <EmbedSpeakerDetail speaker={speaker} fields={fields}>
              <Card>
                <CardContent className="flex items-start gap-3 py-3">
                  {fields.has('headshot') ? (
                    <SpeakerAvatar speaker={speaker} className="size-10" />
                  ) : null}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="font-heading text-sm font-medium">{speaker.name}</p>
                    <SpeakerSubtitle speaker={speaker} fields={fields} />
                    {fields.has('sessions') ? (
                      <EmbedSpeakerSessions sessions={speaker.sessions} className="pt-1" />
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </EmbedSpeakerDetail>
          </EmbedSpeakerItem>
        ))}
      </div>
    </div>
  )
}

export function EmbedSpeakerGalleryView({ speakers, fields }: RosterProps) {
  return (
    <div className="flex flex-col">
      {/* The gallery's own name search. It had none, so a grid of headshots could not be
          narrowed to one person, which is the whole of what EMB-12 was missing. */}
      <EmbedSpeakerSearch speakers={speakers.map(searchable)} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {speakers.map((speaker) => (
          <EmbedSpeakerItem key={speaker.id} speaker={searchable(speaker)}>
            <EmbedSpeakerDetail speaker={speaker} fields={fields} className="h-full">
              <Card className="h-full">
                <CardContent className="flex flex-col items-center gap-2 py-4 text-center">
                  {fields.has('headshot') ? (
                    <SpeakerAvatar speaker={speaker} className="size-16" />
                  ) : null}
                  <p className="text-pretty font-heading text-sm font-medium">{speaker.name}</p>
                  <SpeakerSubtitle speaker={speaker} fields={fields} centered />
                </CardContent>
              </Card>
            </EmbedSpeakerDetail>
          </EmbedSpeakerItem>
        ))}
      </div>
    </div>
  )
}

/** Only what the search reads, so a bio never crosses to the browser to be matched against. */
function searchable(speaker: EmbedSpeaker) {
  return {
    id: speaker.id,
    name: speaker.name,
    ...(speaker.tagline === undefined ? {} : { tagline: speaker.tagline }),
    ...(speaker.company === undefined ? {} : { company: speaker.company }),
  }
}

function SpeakerAvatar({ speaker, className }: { speaker: EmbedSpeaker; className: string }) {
  return (
    <Avatar className={className}>
      {speaker.headshotUrl === undefined ? null : (
        <AvatarImage
          src={speaker.headshotUrl}
          alt={speaker.name}
          // A headshot arrives from an organizer's upload and can be any colour, including one
          // that meets the card background. The outline is PURE black/white so it separates the
          // photo without picking up the surface tint underneath it.
          className="outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
        />
      )}
      <AvatarFallback>{speaker.initials}</AvatarFallback>
    </Avatar>
  )
}

/** Tagline, or company, or nothing, filtered by what the Speaker card still shows. */
function SpeakerSubtitle({
  speaker,
  fields,
  centered = false,
}: {
  speaker: EmbedSpeaker
  fields: EmbedFieldSet
  centered?: boolean
}) {
  const parts = [
    fields.has('tagline') ? speaker.tagline : undefined,
    fields.has('company') ? speaker.company : undefined,
  ].filter((part) => part !== undefined)
  if (parts.length === 0) return null
  return (
    <p
      className={
        centered ? 'text-pretty text-xs text-muted-foreground' : 'text-sm text-muted-foreground'
      }
    >
      {parts.join(' · ')}
    </p>
  )
}
