// The five Styled HTML views, rendered, with Field Options applied. R9.
//
// EVERY LAYOUT HERE IS AUTHORED. Ref 33 shows the Agenda view as an empty dark band inside the
// preview's browser mock, and docs/parity/cms-embeds.md records "exact rendered markup of each of
// the five views" as an ambiguity, so there is nothing to transcribe. What is borrowed instead is
// the shape the public agenda page already established (@/features/agenda/PublicSchedule): a card
// per day, a fixed time column with tabular figures, track and room as badges. Reusing that
// rather than inventing a second visual language means the embed and `/agenda/<slug>` do not
// disagree about what the same event looks like.
//
// What separates the five is AXIS and CHROME, since all five read the same rows:
//
//   Agenda             day CARDS, a row per session.
//   Schedule Itinerary day HEADINGS, the same row. For a page that scrolls as one list.
//   Session List       no day grouping; a flat chronological list carrying its own date.
//   Speaker List       one row per speaker with their sessions under them.
//   Speaker Gallery    a headshot grid.
//
// THE ITINERARY ROW USED TO BE A COMPACT LINE and is not any more. It was a time, a title and
// three muted spans, with no abstract, no expand control and no way into a detail view, while the
// two sibling widgets both had one. That is a card anatomy a visitor cannot act on, so the
// itinerary now draws the SAME `SessionRow` the agenda does and keeps only its lighter day
// chrome. One row component rather than two is also what stops the next defect from landing on
// one surface and not the other, which is exactly how the speaker job titles went missing here
// while the agenda kept them.
//
// FIELD OPTIONS ARE READ HERE AND IN @/features/cms/EmbedSessionParts, NOWHERE ELSE.
// `projection.fields` is the set the organizer left switched on for the card this view draws,
// with the required tier unioned back in (@/features/cms/field-options). Deselecting a field has
// to remove it from this markup, or the panel is a control nothing reads, which is the defect
// this surface keeps producing.
//
// No dates are computed here. Every label and clock time arrives pre-formatted in the EVENT's
// timezone and in the organizer's chosen `Date/Time Format` from the projection, because Workers
// run `Date` and `Intl` in UTC and a `toLocaleString` in this file would show every visitor the
// wrong hour.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmbedScheduleStar } from '@/features/cms/EmbedScheduleBar'
import { EmbedSessionDetail } from '@/features/cms/EmbedSessionDetail'
import {
  type EmbedFieldSet,
  SessionBadges,
  SessionDescription,
  SessionSpeakers,
} from '@/features/cms/EmbedSessionParts'
import { EmbedSpeakerGalleryView, EmbedSpeakerListView } from '@/features/cms/EmbedSpeakerViews'
import { EmbedDaySection, EmbedNoResults, EmbedSessionItem } from '@/features/cms/EmbedViewState'
import type { EmbedBody, EmbedDay, EmbedFlatSession } from '@/features/cms/projection'
import type { EmbedSession } from '@/features/cms/projection-days'

export function EmbedViewBody({ body, fields }: { body: EmbedBody; fields: EmbedFieldSet }) {
  switch (body.view) {
    case 'agenda':
      return <AgendaView days={body.days} fields={fields} />
    case 'schedule_itinerary':
      return <ItineraryView days={body.days} fields={fields} />
    case 'session_list':
      return <SessionListView sessions={body.sessions} fields={fields} />
    case 'speaker_list':
      return <EmbedSpeakerListView speakers={body.speakers} fields={fields} />
    case 'speaker_gallery':
      return <EmbedSpeakerGalleryView speakers={body.speakers} fields={fields} />
  }
}

type DaysProps = { days: readonly EmbedDay[]; fields: EmbedFieldSet }

function AgendaView({ days, fields }: DaysProps) {
  return (
    <div className="flex flex-col gap-4">
      {days.map((day) => (
        // The heading and its rows are hidden TOGETHER. Before this gate the card was
        // server-rendered per day while only the rows inside were narrowed, so picking `TUE`
        // printed an empty Monday card above the Tuesday one.
        <EmbedDaySection key={day.key} dayKey={day.key}>
          <Card>
            <CardHeader>
              <CardTitle className="font-heading text-base">{day.label}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border">
              {day.sessions.map((session) => (
                <EmbedSessionItem key={session.id} sessionId={session.id}>
                  <EmbedSessionDetail session={session} timeLabel={session.time}>
                    <SessionRow session={session} fields={fields} />
                  </EmbedSessionDetail>
                </EmbedSessionItem>
              ))}
            </CardContent>
          </Card>
        </EmbedDaySection>
      ))}
      <EmbedNoResults />
    </div>
  )
}

function ItineraryView({ days, fields }: DaysProps) {
  return (
    <div className="flex flex-col gap-4">
      {days.map((day) => (
        <EmbedDaySection key={day.key} dayKey={day.key}>
          <section className="flex flex-col">
            <h2 className="pb-1 font-heading text-sm font-semibold text-muted-foreground">
              {day.label}
            </h2>
            <div className="divide-y divide-border border-t border-border">
              {day.sessions.map((session) => (
                <EmbedSessionItem key={session.id} sessionId={session.id}>
                  <EmbedSessionDetail session={session} timeLabel={session.time}>
                    <SessionRow session={session} fields={fields} />
                  </EmbedSessionDetail>
                </EmbedSessionItem>
              ))}
            </div>
          </section>
        </EmbedDaySection>
      ))}
      <EmbedNoResults />
    </div>
  )
}

function SessionListView({
  sessions,
  fields,
}: {
  sessions: readonly EmbedFlatSession[]
  fields: EmbedFieldSet
}) {
  return (
    <div className="flex flex-col gap-2">
      {sessions.map((session) => (
        <EmbedSessionItem key={session.id} sessionId={session.id}>
          <EmbedSessionDetail session={session} timeLabel={session.stamp}>
            <Card className="relative">
              <CardContent className="flex flex-col gap-1 py-3">
                {/* `date` is required on the Session card and `time` is not, so the row prints the
                  full stamp when time is on and the day alone when it is off. Both arrive
                  pre-composed, because choosing between them needs the date format and this file
                  has none. */}
                <p className="text-xs tabular-nums text-muted-foreground">
                  {fields.has('time') ? session.stamp : session.dayLabel}
                </p>
                <h3 className="text-pretty font-heading text-sm font-medium">{session.title}</h3>
                <SessionSpeakers session={session} fields={fields} />
                <SessionDescription session={session} fields={fields} />
                <SessionBadges session={session} fields={fields} />
              </CardContent>
              {/* A client island in a server-rendered card. It reads the schedule from context
                and renders nothing when there is no provider, which is what keeps the
                editor's preview from offering a schedule it has nowhere to store. */}
              <div className="absolute right-1 top-1">
                <EmbedScheduleStar sessionId={session.id} />
              </div>
            </Card>
          </EmbedSessionDetail>
        </EmbedSessionItem>
      ))}
      <EmbedNoResults />
    </div>
  )
}

/** The row both day-grouped views draw. */
function SessionRow({ session, fields }: { session: EmbedSession; fields: EmbedFieldSet }) {
  return (
    <div className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:gap-5">
      {/* Fixed-width time column on wide screens so the slots line up down the day, and tabular
          figures so `9:00` and `11:00` do not shift the titles beside them. `time` is a required
          field on the Agenda card, so there is no branch here. */}
      <p className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground sm:w-40">
        {session.time}
      </p>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="text-pretty font-heading text-sm font-medium">{session.title}</h3>
        <SessionSpeakers session={session} fields={fields} />
        <SessionDescription session={session} fields={fields} />
        <SessionBadges session={session} fields={fields} />
      </div>
      <EmbedScheduleStar sessionId={session.id} />
    </div>
  )
}
