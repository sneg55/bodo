// What a served embed renders, as a pure function. R9's real deliverable.
//
// One function decides three things that are each expensive to debug through a page on somebody
// else's website, which is why they are here and tested rather than inside the route:
//
//   1. WHETHER the embed serves at all. A disabled embed projects `undefined`, and the route
//      turns that into a 404. Putting the switch here rather than in the route means the
//      property is provable without a request, and means there is one answer rather than one
//      per view.
//   2. WHICH rows are public. `publicAgendaRows` is called here, and it is the SAME function
//      the public agenda page and `listPublishedAgenda` use, not a second filter: published,
//      not cancelled, review status still accepted. A withdrawn session keeps
//      `scheduleStatus: 'published'`, so without that third rule an embed would keep rendering
//      a talk the speaker pulled out of. Calling it again on rows that came through
//      `listPublishedAgenda` is deliberate and harmless (it filters and sorts, so it is
//      idempotent): the read-side guarantee and the tested guarantee are then the same rule
//      applied twice rather than one place trusting the other.
//   3. WHICH shape. The five views are three projections of the same rows: two day-grouped, one
//      flat, two rosters.
//
// The grouping, the day labels and every clock time come from `groupPublicSchedule`, which
// formats in the EVENT's timezone. Nothing here calls a Date method: Workers run `Date` and
// `Intl` in UTC, so a raw `toLocaleString` in an embed would show a 9am session at 4pm to every
// reader of the conference's own website.

import type { ScheduleStatus, SubmissionStatus } from '@/constants/status'
import { publicAgendaRows } from '@/features/agenda/public-agenda'
import { groupPublicSchedule } from '@/features/agenda/public-schedule'
import type { EmbedDeepLink } from '@/features/cms/deep-link'
import { cardTypeForView, visibleEmbedFields } from '@/features/cms/field-options'
import { applyEmbedFilters } from '@/features/cms/filters'
import {
  type EmbedDay,
  type EmbedFlatSession,
  embedSessionSlots,
  flattenEmbedDays,
  relabelEmbedDays,
} from '@/features/cms/projection-days'
import {
  type EmbedSpeaker,
  type EmbedSpeakerSource,
  embedSpeakers,
  focusSpeakers,
} from '@/features/cms/speakers'
import { embedStyleVars } from '@/features/cms/style-options'
import {
  type CmsEmbed,
  type EmbedCardType,
  type EmbedDateFormat,
  type EmbedTheme,
  type EmbedView,
  embedViewLabel,
} from '@/types/cms'
import type { Room, Track } from '@/types/domain'

/** What the projection needs off a submission. `SubmissionWithParticipants` satisfies it. */
export type EmbedSourceRow = {
  id: string
  title: string
  // The three columns the visibility rule reads, at their real types rather than as strings, so
  // `publicAgendaRows` infers this row type and a test cannot assert a status that cannot exist.
  status: SubmissionStatus
  scheduleStatus: ScheduleStatus
  calendarStatus: 'active' | 'cancelled'
  startsAt?: string
  endsAt?: string
  roomId?: string
  trackId?: string
  // The three dimensions the Filters section narrows on that are not already above. Present here
  // and not read anywhere else in this module: `applyEmbedFilters` owns them.
  tagIds: readonly string[]
  format?: string
  language?: string
  participants: readonly { speaker: EmbedSpeakerSource }[]
}

/** Re-exported so consumers keep importing one module. Defined in ./projection-days. */
export type { EmbedDay, EmbedFlatSession }

export type EmbedBody =
  | { view: 'agenda'; days: readonly EmbedDay[] }
  | { view: 'schedule_itinerary'; days: readonly EmbedDay[] }
  | { view: 'session_list'; sessions: readonly EmbedFlatSession[] }
  | { view: 'speaker_list'; speakers: readonly EmbedSpeaker[] }
  | { view: 'speaker_gallery'; speakers: readonly EmbedSpeaker[] }

export type EmbedProjection = {
  /** Ref 33's blue header band. */
  eventName: string
  view: EmbedView
  viewLabel: string
  /** The deep-linked speaker's name, when one resolved. Absent when no filter applied. */
  focus?: string
  body: EmbedBody
  /** Whether the chosen view has anything at all, so the route can render one empty state. */
  empty: boolean

  // ── What Style Options and Field Options do to the output ──────────────────────────────────
  /** `Website Color Theme`. The frame puts `dark` on a WRAPPER, since `.dark` styles descendants. */
  theme: EmbedTheme
  /** `Primary Color`, as the two CSS custom properties the header band resolves against. */
  styleVars: Readonly<Record<string, string>>
  /** `Extra CSS Code`, already sanitized by the mapper. Absent when there is none to emit. */
  extraCss?: string
  /** Which of the three Field Options cards this view draws. */
  card: EmbedCardType
  /** The field keys this view renders. Required fields are always in it. */
  fields: ReadonlySet<string>
}

/**
 * Everything the projection reads off the embed record.
 *
 * The whole shape rather than two fields, so adding a column that changes the output is a type
 * error here rather than a control an organizer can set and nothing reads. `readServedEmbed` passes
 * its `CmsEmbed` straight in.
 */
export type EmbedProjectionEmbed = Pick<
  CmsEmbed,
  | 'enabled'
  | 'view'
  | 'colorTheme'
  | 'primaryColor'
  | 'dateTimeFormat'
  | 'extraCss'
  | 'filters'
  | 'fieldOptions'
>

export type EmbedProjectionInput = {
  embed: EmbedProjectionEmbed
  event: { name: string; timezone: string }
  rows: readonly EmbedSourceRow[]
  rooms: readonly Room[]
  tracks: readonly Track[]
  deepLink: EmbedDeepLink
}

/**
 * The whole projection, or `undefined` when this embed does not serve.
 *
 * `undefined` and not an empty projection: an empty one renders a header band and a "nothing
 * scheduled yet" line, which tells a visitor the feed is working, and a disabled embed has to be
 * indistinguishable from one that was never created.
 */
export function embedProjection(input: EmbedProjectionInput): EmbedProjection | undefined {
  if (!input.embed.enabled) return undefined

  // The URL may override the view. It cannot override anything else: `sb-view` picks a layout
  // over rows the visibility rule has already chosen (./deep-link says why it exists).
  const view = input.deepLink.view ?? input.embed.view
  const format = input.embed.dateTimeFormat
  // ORDER MATTERS. The visibility rule runs FIRST and the organizer's filters run over what it
  // allows, never the other way round: a filter can only ever narrow the published, accepted,
  // uncancelled set, so no combination of stored filter values can widen what an embed serves.
  const rows = applyEmbedFilters(publicAgendaRows(input.rows), input.embed.filters)
  const focused = focusRows(rows, input.deepLink.speakerId)
  const days = relabelEmbedDays(
    groupPublicSchedule(
      focused,
      { rooms: input.rooms, tracks: input.tracks },
      input.event.timezone,
    ),
    focused,
    input.event.timezone,
    format,
  )
  // Flattened ONCE and used twice: it is the Session List's own body, and it is where a
  // speaker's session sublist gets the date and room it prints. Building it twice would let
  // the two disagree the moment either formatting rule changed.
  const sessions = flattenEmbedDays(days, format)
  const speakers = focusSpeakers(
    embedSpeakers(focused, embedSessionSlots(sessions)),
    input.deepLink.speakerId,
  )
  const body = bodyFor(view, days, sessions, speakers)
  const card = cardTypeForView(view)

  return {
    eventName: input.event.name,
    view,
    viewLabel: embedViewLabel(view),
    ...focusLabel(focused, input.deepLink.speakerId),
    body,
    empty: isEmpty(body),
    theme: input.embed.colorTheme,
    styleVars: embedStyleVars(input.embed.primaryColor),
    // Spread, so the frame's "is there custom CSS" check is one `undefined` comparison and no
    // empty `<style>` element is emitted on a page this app does not control.
    ...(input.embed.extraCss === undefined ? {} : { extraCss: input.embed.extraCss }),
    card,
    fields: visibleEmbedFields(input.embed.fieldOptions, card),
  }
}

function bodyFor(
  view: EmbedView,
  days: readonly EmbedDay[],
  sessions: readonly EmbedFlatSession[],
  speakers: readonly EmbedSpeaker[],
): EmbedBody {
  switch (view) {
    case 'session_list':
      return { view, sessions }
    case 'speaker_list':
    case 'speaker_gallery':
      return { view, speakers }
    // Named rather than left to a `default`, so adding a sixth view to EMBED_VIEWS is a type
    // error here instead of a view that silently renders the agenda.
    case 'agenda':
    case 'schedule_itinerary':
      return { view, days }
  }
}

/**
 * Rows a deep-linked speaker appears on, or every row.
 *
 * An id that matches nobody yields NO rows rather than every row. That is the safe direction and
 * it is the one a hostile-but-well-formed value takes: a stranger appending a random
 * `sb-speaker-id` gets an empty feed, never the whole schedule under a filter that quietly did
 * not apply.
 */
function focusRows(
  rows: readonly EmbedSourceRow[],
  speakerId: string | undefined,
): readonly EmbedSourceRow[] {
  if (speakerId === undefined) return rows
  return rows.filter((row) =>
    row.participants.some((participant) => participant.speaker.id === speakerId),
  )
}

/** The deep-linked speaker's display name, resolved off the rows they appear on. */
function focusLabel(
  rows: readonly EmbedSourceRow[],
  speakerId: string | undefined,
): { focus?: string } {
  if (speakerId === undefined) return {}
  for (const row of rows) {
    const match = row.participants.find((participant) => participant.speaker.id === speakerId)
    if (match !== undefined) {
      return { focus: `${match.speaker.firstName} ${match.speaker.lastName}`.trim() }
    }
  }
  return {}
}

function isEmpty(body: EmbedBody): boolean {
  if (body.view === 'session_list') return body.sessions.length === 0
  if (body.view === 'speaker_list' || body.view === 'speaker_gallery') {
    return body.speakers.length === 0
  }
  return body.days.length === 0
}
