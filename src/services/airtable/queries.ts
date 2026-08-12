// The read surface. Everything outside this directory reads through here.
//
// It used to be where caching lived: one `'use cache'` function per read, each with an
// explicit `cacheTag` and `cacheLife`. That is gone, because `@opennextjs/cloudflare`
// cannot resume a partially prerendered route and `cacheComponents` had to come off with
// it, taking `'use cache'`, `cacheTag` and `cacheLife` along. The tags moved DOWN into
// the reads, where each one is declared next to the table and event it belongs to and
// travels on the request itself (read-cache.ts, and the tag builders in tags.ts are
// unchanged because they are what the mutations invalidate).
//
// So these are pass-throughs now, and the file is kept for two reasons rather than
// inlined away:
//
//   - It is the import boundary. About fifteen files outside this directory import from
//     here, and none of them should have to know whether a read is served by Airtable,
//     by a fixture, or from a cache.
//   - It is where the fixture branch is resolved. `getSource()` answers "is there an
//     Airtable base" exactly once (source.ts), so a caller cannot get it wrong.
//
// A read that renders in a page belongs here. A read a MUTATION uses does not: those are
// uncached by construction and live in reads*.ts, because a write that decides what to do
// from a cached read can act on data that is already gone.

import type { TaskAssignmentItem } from '@/services/airtable/reads-portal'
import type { FileRequestItem } from '@/services/airtable/reads-requests'
import { getSource } from '@/services/airtable/source'
import type { CmsEmbed } from '@/types/cms'
import type { SpeakerInEvents } from '@/types/crm'
import type {
  AdminUser,
  EmailTemplate,
  EvaluationPlan,
  Event,
  EventMembership,
  OutboxRow,
  ReviewAssignment,
  Room,
  Round,
  Speaker,
  SpeakerList,
  SpeakerTag,
  StoredFile,
  SubmissionWithParticipants,
  Tag,
  Task,
  Track,
} from '@/types/domain'
import type { FileRequest } from '@/types/file-requests'
import type { Form } from '@/types/forms'
import type { PortalItem, Resource } from '@/types/resources'
import type { SavedView, SavedViewSurface } from '@/types/saved-views'

export async function getEvent(eventId: string): Promise<Event> {
  return await getSource().getEvent(eventId)
}

/**
 * The event behind a public URL, which carries a slug and not a record id.
 *
 * `undefined` rather than a throw, because the only caller is the public agenda and an
 * unknown slug there is a 404. The page has to resolve it in its own body, before the
 * first byte: `notFound()` from inside a `<Suspense>` boundary never produces a response
 * on Workers.
 */
export async function getEventBySlug(slug: string): Promise<Event | undefined> {
  return await getSource().getEventBySlug(slug)
}

export async function listSubmissions(
  eventId: string,
): Promise<readonly SubmissionWithParticipants[]> {
  return await getSource().listSubmissions(eventId)
}

/** Every submission across a set of events. What the speaker portal is scoped by. */
export async function listSubmissionsForEvents(
  eventIds: readonly string[],
): Promise<readonly SubmissionWithParticipants[]> {
  return await getSource().listSubmissionsForEvents(eventIds)
}

export async function getSubmission(submissionId: string): Promise<SubmissionWithParticipants> {
  return await getSource().getSubmission(submissionId)
}

export async function getSubmissionByCode(
  eventId: string,
  code: string,
): Promise<SubmissionWithParticipants> {
  return await getSource().getSubmissionByCode(eventId, code)
}

export async function listForms(eventId: string): Promise<readonly Form[]> {
  return await getSource().listForms(eventId)
}

export async function getFormByPublicId(publicId: string): Promise<Form> {
  return await getSource().getFormByPublicId(publicId)
}

export async function listTracks(eventId: string): Promise<readonly Track[]> {
  return await getSource().listTracks(eventId)
}

export async function listTags(eventId: string): Promise<readonly Tag[]> {
  return await getSource().listTags(eventId)
}

export async function listRooms(eventId: string): Promise<readonly Room[]> {
  return await getSource().listRooms(eventId)
}

export async function listSpeakers(eventId: string): Promise<readonly Speaker[]> {
  return await getSource().listSpeakers(eventId)
}

export async function listAssignmentsForReviewer(
  eventId: string,
  reviewerId: string,
): Promise<readonly ReviewAssignment[]> {
  return await getSource().listAssignmentsForReviewer(eventId, reviewerId)
}

export async function getActivePlan(eventId: string): Promise<EvaluationPlan | undefined> {
  return await getSource().getActivePlan(eventId)
}

export async function listRoundsForActivePlan(eventId: string): Promise<readonly Round[]> {
  return await getSource().listRoundsForActivePlan(eventId)
}

export async function listEvaluationPlans(eventId: string): Promise<readonly EvaluationPlan[]> {
  return await getSource().listEvaluationPlans(eventId)
}

export async function listRounds(eventId: string): Promise<readonly Round[]> {
  return await getSource().listRounds(eventId)
}

export async function getSpeaker(speakerId: string): Promise<Speaker> {
  return await getSource().getSpeaker(speakerId)
}

export {
  listEmailTemplates,
  listFileRequestAssignmentsForEvent,
  listFileRequestAssignmentsForSpeaker,
  listFileRequests,
  listFilesForEventSpeakers,
  listFilesForSpeaker,
  listFilesForSubmission,
  listTaskAssignmentsForEvent,
  listTaskAssignmentsForSpeaker,
  listTasksForEvent,
} from '@/services/airtable/queries-portal'
// The public agenda read lives in ./queries-public.ts: it is the one read serving an
// ANONYMOUS visitor, so its filter is a disclosure boundary rather than a convenience, and
// it carries the content approval gate. The portal-side reads live in ./queries-portal.ts.
// Both are re-exported here, so this file stays the one import boundary the header
// describes. They moved when this file passed the size budget.
export { listPublishedAgenda } from '@/services/airtable/queries-public'

/**
 * The event's resource pages, draft and published alike. R8.
 *
 * Unfiltered on purpose: the admin list needs the drafts, and deciding which pages a
 * SPEAKER may see is `speakerResources` in @/features/resources/pages, which needs the
 * PortalItems rows below to answer. A page read never calls one without the other.
 */
export async function listResources(eventId: string): Promise<readonly Resource[]> {
  return await getSource().listResources(eventId)
}

/** The rows that publish and order portal surfaces, resources included. */
export async function listPortalItems(eventId: string): Promise<readonly PortalItem[]> {
  return await getSource().listPortalItems(eventId)
}

/**
 * The event's portals, in assignment order. BUILD_SPEC 5.0c.
 *
 * A re-export rather than a `getSource()` pass-through like the two reads above, and the
 * difference is not tidiness: `getSource()` resolves the FIXTURE branch, and there is no
 * portals fixture. An empty fixture answer here would not degrade a screen, it would put
 * every contact in no portal at all, which is the state `matchPortal` returns `undefined`
 * for and which reads on the list screen as an event that simply has no portals. Coming
 * straight off `reads-portals.ts` means a missing base fails loudly at `getClient()`
 * instead, which is the posture `mutations-portals.ts` already takes on the write side.
 *
 * The WRITE path does not come through here. It needs `listPortalsUncached`
 * (reads-portals.ts), because deciding exactly-one-default from a cached list is how an
 * event ends up with two.
 */
export { listPortals } from '@/services/airtable/reads-portals'

/**
 * The event's CMS embeds, enabled and disabled alike. R9.
 *
 * Unfiltered on purpose: ref 32's segmented filter has a `Disabled` tab with its own live
 * count, so the disabled rows are the list's content. Whether an embed SERVES is decided by
 * the public route, from the row this read hands back (@/features/cms/served-embed).
 */
export async function listCmsEmbeds(eventId: string): Promise<readonly CmsEmbed[]> {
  return await getSource().listCmsEmbeds(eventId)
}

/**
 * One embed by the opaque id in its public URL. `undefined` is a normal answer.
 *
 * The caller is an unauthenticated route pasted into somebody else's website, where an
 * unknown id is a 404. It must resolve this in its own page BODY, before the first byte:
 * `notFound()` from inside a `<Suspense>` boundary answers HTTP 200 with the 404 body on
 * Workers, which for an embed means a third-party page rendering our not-found copy.
 */
export async function getCmsEmbedByPublicId(publicId: string): Promise<CmsEmbed | undefined> {
  return await getSource().getCmsEmbedByPublicId(publicId)
}

/**
 * The saved views on one list surface: the Saved Views dropdown's contents.
 *
 * Cached and tagged like every other page read, so opening Abstracts costs one extra
 * Airtable request per invalidation rather than one per navigation. The WRITE path does not
 * come through here: it needs uncached reads to decide which name is taken and which row
 * holds the default flag, and those live in reads-saved-views.ts.
 */
export async function listSavedViews(
  eventId: string,
  surface: SavedViewSurface,
): Promise<readonly SavedView[]> {
  return await getSource().listSavedViews(eventId, surface)
}

/** Capability lookup for the auth guards, read on essentially every admin request. */
export async function listMembershipsForUser(userId: string): Promise<readonly EventMembership[]> {
  return await getSource().listMembershipsForUser(userId)
}

/**
 * Identity resolution for the login form. NOT cached, in reads-identity.ts: an account
 * created seconds ago must be able to log in, and a negative answer held for an hour is
 * a speaker who cannot get into their own portal.
 */
export async function findAdminUserByEmail(email: string): Promise<AdminUser | undefined> {
  return await getSource().findAdminUserByEmail(email)
}

export async function findSpeakerByEmail(email: string): Promise<Speaker | undefined> {
  return await getSource().findSpeakerByEmail(email)
}

/**
 * Speakers across several events at once, for the cross-event CRM directory. Pass the
 * viewer's own membership set: a speaker is reachable only through an event the caller
 * belongs to, and that scoping is the caller's job, not this read's.
 */
export async function listSpeakersForEvents(
  eventIds: readonly string[],
): Promise<readonly Speaker[]> {
  return await getSource().listSpeakersForEvents(eventIds)
}

/** The same roster, keeping each speaker's links to the events that were asked about. */
export async function listSpeakersInEvents(
  eventIds: readonly string[],
): Promise<readonly SpeakerInEvents[]> {
  return await getSource().listSpeakersInEvents(eventIds)
}

/** The global speaker tag vocabulary, not scoped to any one event. */
export async function listSpeakerTags(): Promise<readonly SpeakerTag[]> {
  return await getSource().listSpeakerTags()
}

/** One user's saved speaker filters: the CRM directory's list picker. */
export async function listSpeakerLists(userId: string): Promise<readonly SpeakerList[]> {
  return await getSource().listSpeakerLists(userId)
}

/** One speaker's sent mail, across every event, for the CRM timeline. */
export async function listOutboxForSpeaker(speakerId: string): Promise<readonly OutboxRow[]> {
  return await getSource().listOutboxForSpeaker(speakerId)
}

/** The tag ids applied to one speaker, for the CRM profile's tag chips. */
export async function listSpeakerTagIds(speakerId: string): Promise<readonly string[]> {
  return await getSource().listSpeakerTagIds(speakerId)
}

/** Every speaker's tag ids, keyed by speaker, for the cross-event CRM directory. */
export async function listSpeakerTagMembership(): Promise<ReadonlyMap<string, readonly string[]>> {
  return await getSource().listSpeakerTagMembership()
}
