'use client'

// The profile's Details panel: General, Speaker Tags, Links, Logistics, Biography.
//
// Split out of `SpeakerProfile.tsx` when the fourth tab landed, on the seam the file already
// had: that file owns the header, the tab strip and the two sheets, and each panel is a
// module of its own (`SpeakerProfilePanels.tsx` holds the other two). It was at 255 lines
// before the Notes and Activity tab was wired in.
//
// THE LOGISTICS CARD IS NEW and it closes half of what CRM-03 reported. `Dietary` and
// `Travel notes` were writable from the speaker edit sheet and rendered on no read view, so a
// note an organizer typed was invisible unless somebody reopened the dialog it was typed
// into. `Last invited` is on the same card for the same reason: it is stored on the Speakers
// row, the roster shows it, and this page did not.
//
// COPY IS AUTHORED, and labelled as such wherever it is not lifted from something that
// already shipped. The parity report waives the whole CRM area, so there is nothing to
// transcribe. The field labels are the exceptions and they are verbatim: `Email`,
// `Mobile Phone`, `Biography`, `Company`, `First Name`, `Last Name` from the column catalog
// the directory already uses (`constants/speaker-crm-fields.ts`), `Salutation`, `Honorific`,
// `Pronouns`, `Gender` from the portal's own profile form, and `Dietary` and `Travel notes`
// from the speaker edit sheet that writes them.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { SpeakerProfileView } from '@/features/crm/profile'
import { SpeakerTagEditor } from '@/features/crm/SpeakerTagEditor'
import { speakerProfileLinks } from '@/features/crm/speaker-links'
import { speakerBioText } from '@/features/crm/speaker-rows'
import type { Speaker } from '@/types/domain'

import { Field } from './SpeakerProfilePanels'

export function SpeakerDetailsTab({
  speaker,
  tags,
  vocabulary,
  logistics,
  invitedAtText,
}: {
  speaker: Speaker
  tags: SpeakerProfileView['tags']
  vocabulary: SpeakerProfileView['vocabulary']
  logistics: SpeakerProfileView['logistics']
  invitedAtText?: string
}) {
  const bio = speakerBioText(speaker)
  const links = speakerProfileLinks(speaker)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Field label="Email" value={speaker.email} />
          <Field label="Mobile Phone" value={speaker.phone} />
          <Field label="Company" value={speaker.company} />
          <Field label="Salutation" value={speaker.salutation} />
          <Field label="First Name" value={speaker.firstName} />
          <Field label="Last Name" value={speaker.lastName} />
          <Field label="Honorific" value={speaker.honorific} />
          <Field label="Pronouns" value={speaker.pronouns} />
          <Field label="Gender" value={speaker.gender} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Speaker Tags</CardTitle>
          </CardHeader>
          <CardContent>
            <SpeakerTagEditor speakerId={speaker.id} tags={tags} vocabulary={vocabulary} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            {/* `My Links` in the portal, where the speaker owns them. `Links` here, because
                an organizer is reading somebody else's. */}
            <CardTitle>Links</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {links.length === 0 ? (
              <p className="text-sm text-muted-foreground">No links yet.</p>
            ) : (
              links.map((link) => (
                <div key={link.label} className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">{link.label}</span>
                  {/* An href only when one can be made of what the speaker typed; see
                      `speakerLinkHref`. The stored text is what is SHOWN either way, so a
                      value that cannot be linked is still readable rather than hidden. */}
                  {link.href === undefined ? (
                    <span className="truncate text-sm text-muted-foreground">{link.text}</span>
                  ) : (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-sm text-primary underline-offset-4 hover:underline"
                    >
                      {link.text}
                    </a>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Logistics</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Field label="Dietary" value={logistics.dietary} />
            {/* Already formatted AND already zone-named on the server (`invitedAtText`), on
                the same clock as the Communication and Notes tabs. See `profileTimezone`. */}
            <Field label="Last invited" value={invitedAtText} />
          </div>
          {/* Its own block rather than a third `Field`, because a travel arrangement is
              prose: "arrives Thursday 21:40, needs a car from the airport" wraps, and
              `Field` truncates to one line by design. This is the value that was stored and
              never rendered anywhere. */}
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Travel notes</span>
            {logistics.travelNotes === undefined || logistics.travelNotes.trim() === '' ? (
              <span className="text-sm text-muted-foreground">-</span>
            ) : (
              <p className="text-pretty text-sm whitespace-pre-line">{logistics.travelNotes}</p>
            )}
          </div>
          {/* Says which of the two note surfaces this is. The other is the append-only
              Internal Notes feed on the Notes and Activity tab, and an organizer who cannot
              tell them apart will put a permanent decision in a trip field. */}
          <p className="text-xs text-muted-foreground">
            Logistics for this trip, edited from Edit. For a lasting note about the person, use
            Internal Notes.
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Biography</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Plain text, never `dangerouslySetInnerHTML`: this is speaker input and it is
              not sanitized at the read boundary. See `speakerBioText`. */}
          {bio.length === 0 ? (
            <p className="text-sm text-muted-foreground">No biography yet.</p>
          ) : (
            <p className="text-pretty text-sm whitespace-pre-line">{bio}</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
