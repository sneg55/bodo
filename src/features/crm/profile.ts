// One speaker's CRM profile, assembled server-side: who they are, what they are on across
// the viewer's events, and what has been mailed to them.
//
// The page above this file awaits `params` and renders. Everything that decides what the
// profile contains is here, because `src/app/**` holds routes only.
//
// SCOPE IS THE WHOLE POINT of `loadSpeakerProfile`, and it is why the speaker is resolved
// out of `listSpeakersInEvents(scope.eventIds)` rather than through `getSpeaker(id)`. That
// read already intersects each speaker's event links with the viewer's memberships and
// drops anyone left with none, so a record id belonging to somebody else's event resolves
// to `undefined` here and the page answers 404. `getSpeaker(id)` would have answered with
// the person, and the profile would have been a cross-event roster anybody could page
// through by guessing ids. It is also the read the directory just performed, under the same
// cache entry, so arriving from a row costs nothing.
//
// The outbox is intersected too, by `scopedOutbox`. See its note: a speaker is not scoped,
// so their Airtable row carries every organizer's mail.
//
// Reads, and what each one is for:
//   - `listSpeakersInEvents(scope.eventIds)`: the person, and which of YOUR events they
//     are on. One cross-event read, shared with the directory.
//   - `listSubmissions(eventId)` per event THE SPEAKER IS ON, not per event in scope: the
//     sessions they are cast in. Already primed by that event's Abstracts and Agenda.
//   - `getEvent(eventId)` per the same events, for the name of each group and for the ONE
//     timezone the whole page renders in (`profileTimezone`). A single-record read on
//     `REVALIDATE.lookup`, and the context event's copy is already primed by the sidebar.
//   - `listSpeakerTags()` and `listSpeakerTagIds(speakerId)`: the vocabulary and this
//     person's membership. The second is a lookup into the same single read the directory
//     performs (`listSpeakerTagMembership`), so it adds no request.
//   - `listOutboxForSpeaker(speakerId)`: the Communication tab.
//
// Two round trips, not three: the roster read has to land before anything can be said
// about the speaker, and everything else is issued together.

import type { ParticipantRole, SubmissionStatus } from '@/constants/status'
import { resolveSpeakerTags, speakerTagsById } from '@/features/crm/directory'
import {
  type AddableEvent,
  invitedAtText,
  loadAddableEvents,
  loadProfileActivity,
  type ProfileActivity,
  type ProfileLogistics,
  profileActivityRows,
  profileLogistics,
  profileTimezone,
} from '@/features/crm/profile-activity'
import type { CrmScope } from '@/features/crm/scope'
import {
  scopedOutbox,
  speakerTimeline,
  type TimelineRow,
  timelineRows,
} from '@/features/crm/timeline'
import {
  getEvent,
  listOutboxForSpeaker,
  listSpeakersInEvents,
  listSpeakerTagIds,
  listSpeakerTags,
  listSubmissions,
} from '@/services/airtable/queries'
import type { RecordId, Speaker, SpeakerTag, SubmissionWithParticipants } from '@/types/domain'

/** One session this speaker is cast in, flattened for a read-only list. */
export type ProfileSession = {
  readonly id: RecordId
  readonly title: string
  readonly status: SubmissionStatus
  /**
   * Every role they hold on it, deduplicated. Plural because one person can be both
   * presenter and chairperson on one submission, which is the same case `sessionCounts`
   * deduplicates for the directory's count.
   */
  readonly roles: readonly ParticipantRole[]
}

/** One of the viewer's events this speaker is on, with the sessions they are cast in. */
export type ProfileEvent = {
  readonly id: RecordId
  readonly name: string
  /**
   * The venue's timezone. Only the FIRST event's is rendered in, for the whole profile and
   * not just for this group's rows; see `profileTimezone`.
   */
  readonly timezone: string
  readonly sessions: readonly ProfileSession[]
}

export type SpeakerProfileView = {
  readonly speaker: Speaker
  readonly tags: readonly SpeakerTag[]
  /**
   * The WHOLE tag vocabulary, not just this speaker's, because the Speaker Tags card is an
   * editor: a multi-select has to offer what is not applied as well as what is. The read
   * was already being made to resolve `tags` above, so this costs nothing beyond returning
   * what was thrown away.
   */
  readonly vocabulary: readonly SpeakerTag[]
  readonly events: readonly ProfileEvent[]
  /** Across all of them. Labels the tab, so it counts what the tab contains. */
  readonly sessionCount: number
  readonly timeline: readonly TimelineRow[]
  /**
   * The internal notes and the stage moves. Both are ORG level and neither names an event:
   * see `profile-activity.ts`, and `notes.ts` on why an internal note is not `travelNotes`.
   */
  readonly activity: ProfileActivity
  /**
   * The contact's own logistics columns, which were writable from the edit sheet and
   * rendered nowhere before. See `profileLogistics`.
   */
  readonly logistics: ProfileLogistics
  /** When they were last sent a portal invitation, rendered, or absent if never. */
  readonly invitedAtText?: string
  /**
   * The events the viewer could still add this contact to. Empty for a reviewer and for an
   * organizer whose every event they are already on, which is what hides the control.
   */
  readonly addableEvents: readonly AddableEvent[]
  /**
   * The event a profile edit is written through, or absent when there is none, which is
   * what hides the Edit button. See `editableEventId`.
   */
  readonly editableEventId?: RecordId
}

/**
 * The event a profile edit from this page is scoped to: the first of the speaker's in-scope
 * events the viewer holds `admin` on, or `undefined` for a viewer who holds none.
 *
 * The profile is cross-event and `saveSpeakerProfileAction` is not: it takes one event id,
 * checks the viewer's role on it, and then resolves the speaker against THAT event's roster
 * so an admin of one event cannot rewrite another event's speaker by posting a record id.
 * Something has to choose which of the speaker's events satisfies that, and choosing it
 * server-side is what stops the button from existing for a reviewer at all.
 *
 * Which one hardly matters, because the write is the same either way: `saveSpeakerProfile`
 * expires every event the speaker's record links to, not only the one the edit came through
 * (mutations-speakers.ts). First-in-reader's-order keeps it stable across renders.
 *
 * NOT AN ACCESS DECISION. The action re-derives the same answer for itself, per BUILD_SPEC
 * section 4: this only decides what to render.
 */
export function editableEventId(
  scope: CrmScope,
  eventIds: readonly RecordId[],
): RecordId | undefined {
  const admin = new Set(scope.adminEventIds)
  return eventIds.find((eventId) => admin.has(eventId))
}

/**
 * The sessions one speaker is cast in, in the reader's order.
 *
 * Pure, and the reason it is separated from the read: "is this person on this submission,
 * and as what" is a rule, and rules are cheaper to assert without a base
 * (`tests/crm-profile.test.ts`).
 *
 * A submission is included once however many participant rows name the speaker, and the
 * roles are collected off all of them. Counting a co-presenting chairperson twice would
 * contradict the Sessions count the directory already shows for the same person.
 */
export function sessionsForSpeaker(
  speakerId: RecordId,
  submissions: readonly SubmissionWithParticipants[],
): readonly ProfileSession[] {
  return submissions.flatMap((submission) => {
    const roles = submission.participants
      .filter((participant) => participant.speaker.id === speakerId)
      .map((participant) => participant.role)
    if (roles.length === 0) return []
    return [
      {
        id: submission.id,
        title: submission.title,
        status: submission.status,
        roles: [...new Set(roles)],
      },
    ]
  })
}

/**
 * The events the profile groups by: the viewer's events this speaker is on, in the
 * viewer's own membership order.
 *
 * Filtering `scope.eventIds` rather than reading the speaker's `eventIds` directly gives a
 * stable order that matches the rest of the CRM ("order is the reader's order",
 * `scope.ts`); a link cell's order is whatever Airtable stored. It also intersects a second
 * time, which is free and means a future change to the roster read cannot widen this.
 */
export function profileEventIds(
  scope: CrmScope,
  speakerEventIds: readonly RecordId[],
): readonly RecordId[] {
  const onEvent = new Set(speakerEventIds)
  return scope.eventIds.filter((eventId) => onEvent.has(eventId))
}

/**
 * The profile, or `undefined` when this speaker is not reachable through the viewer's
 * scope.
 *
 * `undefined` rather than a throw, for the reason `getEventBySlug` gives: the only caller
 * is a page, and an unreachable id there is a 404 the page must raise from its own BODY.
 * A nonexistent id and somebody else's speaker deliberately return the SAME answer, so the
 * 404 does not disclose which of the two it was.
 */
export async function loadSpeakerProfile(
  scope: CrmScope,
  speakerId: string,
): Promise<SpeakerProfileView | undefined> {
  const roster = await listSpeakersInEvents(scope.eventIds)
  const entry = roster.find((candidate) => candidate.speaker.id === speakerId)
  if (entry === undefined) return undefined

  const eventIds = profileEventIds(scope, entry.eventIds)
  const [events, vocabulary, tagIds, outbox, activity, addableEvents] = await Promise.all([
    Promise.all(eventIds.map((eventId) => loadProfileEvent(eventId, speakerId))),
    listSpeakerTags(),
    listSpeakerTagIds(speakerId),
    listOutboxForSpeaker(speakerId),
    // Unformatted, and finished below: the timezone it renders in comes out of the events
    // read issued beside it, so asking for it here would serialise the two. See its doc.
    loadProfileActivity(speakerId),
    loadAddableEvents(scope, entry.eventIds),
  ])

  // ONE clock for the whole profile: the timeline, both activity feeds and `Last invited`.
  // See `profileTimezone`, which owns the choice and the fallback.
  const timezone = profileTimezone(events)
  const invited = invitedAtText(entry.speaker, timezone)

  return {
    speaker: entry.speaker,
    tags: resolveSpeakerTags(tagIds, speakerTagsById(vocabulary)),
    vocabulary,
    events,
    sessionCount: events.reduce((total, event) => total + event.sessions.length, 0),
    timeline: timelineRows(speakerTimeline(scopedOutbox(outbox, scope.eventIds)), events, timezone),
    activity: profileActivityRows(activity, timezone),
    logistics: profileLogistics(entry.speaker),
    // Spread rather than assigned, because `exactOptionalPropertyTypes` refuses an explicit
    // `undefined` on an optional field. The same shape `cardOf` uses in pipeline.ts.
    ...(invited === undefined ? {} : { invitedAtText: invited }),
    addableEvents,
    editableEventId: editableEventId(scope, eventIds),
  }
}

async function loadProfileEvent(eventId: RecordId, speakerId: string): Promise<ProfileEvent> {
  const [event, submissions] = await Promise.all([getEvent(eventId), listSubmissions(eventId)])
  return {
    id: eventId,
    name: event.name,
    timezone: event.timezone,
    sessions: sessionsForSpeaker(speakerId, submissions),
  }
}
