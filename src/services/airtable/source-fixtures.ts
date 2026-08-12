// The fixture DataSource: what a clone with no Airtable credentials is served.
//
// Split out of source.ts when that file reached its size budget, the same way
// queries-portal.ts was split out of queries.ts. The boundary is the one source.ts's own
// header describes: this file is the "no base" half, source.ts keeps the live wiring and
// the single branch between them.
//
// Read-only, and honest about it. Mutations do not come through here; they call the client
// directly and fail with CFG_ENV_MISSING when there is no base, because a write that
// quietly goes nowhere looks like success and loses a speaker's submission.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { DataSource } from '@/services/airtable/data-source'
import {
  FIXTURE_ADMINS,
  FIXTURE_ASSIGNMENTS,
  FIXTURE_EVENT,
  FIXTURE_FILES,
  FIXTURE_FORM,
  FIXTURE_MEMBERSHIPS,
  FIXTURE_PARTICIPANTS,
  FIXTURE_PLAN,
  FIXTURE_PORTAL_ITEMS,
  FIXTURE_RESOURCES,
  FIXTURE_ROOMS,
  FIXTURE_ROUNDS,
  FIXTURE_SPEAKERS,
  FIXTURE_SUBMISSIONS,
  FIXTURE_TAGS,
  FIXTURE_TASK_ASSIGNMENTS,
  FIXTURE_TASKS,
  FIXTURE_TRACKS,
} from '@/services/airtable/fixtures'
import * as portal from '@/services/airtable/reads-portal'
import type { SubmissionWithParticipants } from '@/types/domain'

const speakerById = new Map(FIXTURE_SPEAKERS.map((speaker) => [speaker.id, speaker]))

/** Same join the live path does, so both sides hand back the same shape. */
function fixtureSubmissions(eventId: string): readonly SubmissionWithParticipants[] {
  return FIXTURE_SUBMISSIONS.filter((submission) => submission.eventId === eventId).map(
    (submission) => ({
      ...submission,
      participants: FIXTURE_PARTICIPANTS.filter(
        (participant) => participant.submissionId === submission.id,
      )
        .map((participant) => {
          const speaker = speakerById.get(participant.speakerId)
          if (speaker === undefined) {
            throw new AppError(ErrorIds.DATA_MISSING_LINK, 'fixture participant has no speaker', {
              participantId: participant.id,
              speakerId: participant.speakerId,
            })
          }
          return { ...participant, speaker }
        })
        .sort((left, right) => left.sortOrder - right.sortOrder),
    }),
  )
}

function missing(what: string, value: string): AppError {
  return new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, `no fixture ${what} for ${value}`, {
    what,
    value,
  })
}

/** The fixture cast, each on the one fixture event. See `listSpeakersForEvents` below. */
const FIXTURE_CAST = FIXTURE_SPEAKERS.map((speaker) => ({ speaker, eventIds: [FIXTURE_EVENT.id] }))

export const fixtureSource: DataSource = {
  getEvent: (eventId) => {
    if (eventId !== FIXTURE_EVENT.id) throw missing('event', eventId)
    return Promise.resolve(FIXTURE_EVENT)
  },

  getEventBySlug: (slug) =>
    Promise.resolve(slug === FIXTURE_EVENT.slug ? FIXTURE_EVENT : undefined),

  listSubmissions: (eventId) => Promise.resolve(fixtureSubmissions(eventId)),

  // A loop is the right implementation HERE and not in the live source: there is one fixture
  // event and no cache to defeat, so the reason the live read exists (one scan instead of
  // one per event) simply does not apply to an in-memory array.
  listSubmissionsForEvents: (eventIds) =>
    Promise.resolve(eventIds.flatMap((eventId) => fixtureSubmissions(eventId))),

  getSubmission: (submissionId) => {
    const match = fixtureSubmissions(FIXTURE_EVENT.id).find((row) => row.id === submissionId)
    if (match === undefined) throw missing('submission', submissionId)
    return Promise.resolve(match)
  },

  getSubmissionByCode: (eventId, code) => {
    const match = fixtureSubmissions(eventId).find((row) => row.code === code)
    if (match === undefined) throw missing('submission', code)
    return Promise.resolve(match)
  },

  listForms: (eventId) => Promise.resolve(FIXTURE_FORM.eventId === eventId ? [FIXTURE_FORM] : []),

  getFormByPublicId: (publicId) => {
    if (publicId !== FIXTURE_FORM.publicId) throw missing('form', publicId)
    return Promise.resolve(FIXTURE_FORM)
  },

  listTracks: (eventId) =>
    Promise.resolve(FIXTURE_TRACKS.filter((track) => track.eventId === eventId)),
  listTags: (eventId) => Promise.resolve(FIXTURE_TAGS.filter((tag) => tag.eventId === eventId)),
  listRooms: (eventId) => Promise.resolve(FIXTURE_ROOMS.filter((room) => room.eventId === eventId)),
  // The fixture Speaker rows carry no event link, so the whole cast belongs to the
  // one fixture event by construction.
  listSpeakers: (eventId) => Promise.resolve(eventId === FIXTURE_EVENT.id ? FIXTURE_SPEAKERS : []),

  getSpeaker: (speakerId) => {
    const speaker = FIXTURE_SPEAKERS.find((row) => row.id === speakerId)
    if (speaker === undefined) {
      throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, `no fixture speaker ${speakerId}`, {
        speakerId,
      })
    }
    return Promise.resolve(speaker)
  },

  listAssignmentsForReviewer: (eventId, reviewerId) => {
    const roundIds = new Set(
      FIXTURE_ROUNDS.filter((round) => round.eventId === eventId).map((round) => round.id),
    )
    return Promise.resolve(
      FIXTURE_ASSIGNMENTS.filter(
        (assignment) => assignment.reviewerId === reviewerId && roundIds.has(assignment.roundId),
      ),
    )
  },

  getActivePlan: (eventId) =>
    Promise.resolve(FIXTURE_PLAN.eventId === eventId ? FIXTURE_PLAN : undefined),

  listRoundsForActivePlan: (eventId) =>
    Promise.resolve(FIXTURE_ROUNDS.filter((round) => round.eventId === eventId)),

  // The fixture base has exactly one plan, so "every plan" and "the active plan" are
  // the same list here. Spelled as a filter anyway rather than `[FIXTURE_PLAN]`, so a
  // second fixture plan does not silently start appearing on the wrong event.
  listEvaluationPlans: (eventId) =>
    Promise.resolve(FIXTURE_PLAN.eventId === eventId ? [FIXTURE_PLAN] : []),

  listRounds: (eventId) =>
    Promise.resolve(FIXTURE_ROUNDS.filter((round) => round.eventId === eventId)),

  listMembershipsForUser: (userId) =>
    Promise.resolve(FIXTURE_MEMBERSHIPS.filter((row) => row.userId === userId)),

  // The fixture tasks all belong to the fixture event, so the join reuses the live
  // path's own filter (`taskItems`) rather than a second copy of it: a fixture that
  // orders or scopes differently from Airtable is a demo that proves the wrong thing.
  listTaskAssignmentsForSpeaker: (eventId, speakerId) =>
    Promise.resolve(
      portal.taskItems(
        FIXTURE_TASKS.filter((task) => task.eventId === eventId),
        FIXTURE_TASK_ASSIGNMENTS,
        (assignment) => assignment.speakerId === speakerId,
      ),
    ),

  listTaskAssignmentsForEvent: (eventId) =>
    Promise.resolve(
      portal.taskItems(
        FIXTURE_TASKS.filter((task) => task.eventId === eventId),
        FIXTURE_TASK_ASSIGNMENTS,
        () => true,
      ),
    ),

  listTasksForEvent: (eventId) =>
    Promise.resolve(FIXTURE_TASKS.filter((task) => task.eventId === eventId)),

  // No fixture file requests, and that is honest rather than lazy: ref 30 captured this
  // surface EMPTY, so an empty list is exactly the state the reference shows, and inventing
  // three fixture requests would demo a fan-out that no fixture assignment could satisfy.
  listFileRequests: () => Promise.resolve([]),
  listFileRequestAssignmentsForEvent: () => Promise.resolve([]),
  listFileRequestAssignmentsForSpeaker: () => Promise.resolve([]),

  listFilesForSpeaker: (speakerId) =>
    Promise.resolve(FIXTURE_FILES.filter((file) => file.speakerId === speakerId)),

  listFilesForSubmission: (submissionId) =>
    Promise.resolve(FIXTURE_FILES.filter((file) => file.submissionId === submissionId)),

  // Scoped by the roster the caller passes, exactly as the live read is: the fixture
  // source must not know an event-to-file shortcut the real table does not have.
  listFilesForEventSpeakers: (_eventId, speakerIds) =>
    Promise.resolve(FIXTURE_FILES.filter((file) => speakerIds.includes(file.speakerId))),

  // Unfiltered by anything but the event, exactly like the live reads: the visibility
  // rule is the feature's (@/features/resources/pages), so a fixture that pre-filtered
  // here would be a demo of a rule the real path does not run.
  // No fixture email templates, and that is the honest state rather than a gap: no stored
  // row means every template is its built-in body, which is what a fresh event looks like
  // and what Settings > Email Templates then shows, with nothing marked Customized.
  listEmailTemplates: () => Promise.resolve([]),

  listResources: (eventId) =>
    Promise.resolve(FIXTURE_RESOURCES.filter((row) => row.eventId === eventId)),

  listPortalItems: (eventId) =>
    Promise.resolve(FIXTURE_PORTAL_ITEMS.filter((row) => row.eventId === eventId)),

  // No fixture embeds, and that is honest rather than lazy. An embed's whole product is a
  // URL a stranger's website loads, and a fixture one would be an URL that renders fixture
  // sessions to the public: the list's empty state and "+ Add Embed" are the real first-run
  // state, and with no base configured there is nowhere to create one anyway.
  listCmsEmbeds: () => Promise.resolve([]),
  getCmsEmbedByPublicId: () => Promise.resolve(undefined),

  // No fixture saved views, and that is honest rather than lazy. The reference never
  // captured the Saved Views dropdown's contents, so any fixture view here would be an
  // invented one presented as a clone, and the writes that create them fail with
  // CFG_ENV_MISSING on a base-less clone anyway. An empty menu with its own empty-state
  // line is the truthful demo.
  listSavedViews: () => Promise.resolve([]),

  // Case-insensitive, because an address typed with different capitalisation is
  // the same account and a second identity is a support ticket nobody can fix.
  findAdminUserByEmail: (email) =>
    Promise.resolve(FIXTURE_ADMINS.find((user) => sameEmail(user.email, email))),

  findSpeakerByEmail: (email) =>
    Promise.resolve(FIXTURE_SPEAKERS.find((speaker) => sameEmail(speaker.email, email))),

  // The fixture Speaker rows carry no event link (see listSpeakers above), so the whole
  // cast is reachable through the one fixture event regardless of which events are asked
  // for.
  listSpeakersForEvents: (eventIds) =>
    Promise.resolve(eventIds.includes(FIXTURE_EVENT.id) ? FIXTURE_SPEAKERS : []),
  listSpeakersInEvents: (eventIds) =>
    Promise.resolve(eventIds.includes(FIXTURE_EVENT.id) ? FIXTURE_CAST : []),

  // No fixture speaker tags, saved lists, or sent mail, and that is honest rather than
  // lazy, the same reasoning as `listSavedViews` and `listCmsEmbeds` above: the CRM is a
  // new surface with nothing captured for it yet, and an empty directory with its own
  // empty-state copy is the truthful first-run demo.
  listSpeakerTags: () => Promise.resolve([]),
  listSpeakerLists: () => Promise.resolve([]),
  listOutboxForSpeaker: () => Promise.resolve([]),
  listSpeakerTagIds: () => Promise.resolve([]),
  listSpeakerTagMembership: () => Promise.resolve(new Map()),
}

function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}
