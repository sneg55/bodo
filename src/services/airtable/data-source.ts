// The read surface queries.ts calls, described once as a type.
//
// It exists so the fixture branch has somewhere to live. `hasAirtable()` is false
// on a clone with an empty `.env`, and the app still has to boot and demo, so
// there are two implementations of exactly this shape (reads.ts against the API,
// and the fixture object in source.ts) and one place that picks between them.
// Without the interface that choice would be an `if` inside every read.
//
// Types only, so both implementations can import it without a cycle.

import type { TaskAssignmentItem } from '@/services/airtable/reads-portal'
import type { FileRequestItem } from '@/services/airtable/reads-requests'
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

export type DataSource = {
  getEvent: (eventId: string) => Promise<Event>

  /**
   * The same event addressed by its slug, which is what a public URL carries.
   * `undefined` is a normal answer: the public agenda turns it into a 404.
   */
  getEventBySlug: (slug: string) => Promise<Event | undefined>

  /**
   * Submissions with their cast resolved. Participants come attached because
   * every consumer needs them (the abstracts table shows presenters, the agenda's
   * overlap check groups by them) and resolving them per row is precisely the
   * per-row fan-out that section 3.1 says will hit the rate cap.
   */
  listSubmissions: (eventId: string) => Promise<readonly SubmissionWithParticipants[]>
  /**
   * The same read over a SET of events, for the speaker portal.
   *
   * Its own port entry rather than the caller looping `listSubmissions`, because the live
   * implementation is genuinely different: one whole-table scan tagged with every event's
   * tags, instead of one scan per event under a cache key that cannot dedupe them.
   */
  listSubmissionsForEvents: (
    eventIds: readonly string[],
  ) => Promise<readonly SubmissionWithParticipants[]>
  getSubmission: (submissionId: string) => Promise<SubmissionWithParticipants>
  /** `code` is what the portal shows a speaker, so it is an addressable key. */
  getSubmissionByCode: (eventId: string, code: string) => Promise<SubmissionWithParticipants>

  listForms: (eventId: string) => Promise<readonly Form[]>
  getFormByPublicId: (publicId: string) => Promise<Form>

  listTracks: (eventId: string) => Promise<readonly Track[]>
  listTags: (eventId: string) => Promise<readonly Tag[]>
  listRooms: (eventId: string) => Promise<readonly Room[]>
  listSpeakers: (eventId: string) => Promise<readonly Speaker[]>
  /** One speaker by record id. The portal reads its own profile through this. */
  getSpeaker: (speakerId: string) => Promise<Speaker>

  listAssignmentsForReviewer: (
    eventId: string,
    reviewerId: string,
  ) => Promise<readonly ReviewAssignment[]>
  /** One active plan per event ships; the schema allows more. Section 3. */
  getActivePlan: (eventId: string) => Promise<EvaluationPlan | undefined>
  listRoundsForActivePlan: (eventId: string) => Promise<readonly Round[]>
  /** Every plan and every round, which only the plan editor needs. */
  listEvaluationPlans: (eventId: string) => Promise<readonly EvaluationPlan[]>
  listRounds: (eventId: string) => Promise<readonly Round[]>

  /**
   * Every membership for one user, across all events. Deliberately not scoped to
   * an event: the guards filter by event themselves, so one cached read serves
   * both the per-event capability check and the event switcher, instead of one
   * read per event per request. This is the seam `src/features/auth` needs and the
   * reason it takes a loader rather than importing this directory.
   */
  listMembershipsForUser: (userId: string) => Promise<readonly EventMembership[]>

  /**
   * Task assignments with their task resolved, for one speaker on one event.
   *
   * The task comes attached for the same reason participants come attached to a
   * submission: no surface wants an assignment without knowing what it is for, and
   * resolving one per row is the per-row fan-out section 3.1 warns about. Scoped by
   * event as well as speaker, because a speaker who presents at two conferences must
   * not see the other one's tasks in this portal.
   */
  listTaskAssignmentsForSpeaker: (
    eventId: string,
    speakerId: string,
    /** Skip the cache. For the write path, which decides ownership from the answer. */
    fresh?: boolean,
  ) => Promise<readonly TaskAssignmentItem[]>

  /** The admin side of the same graph: every assignment on the event. */
  listTaskAssignmentsForEvent: (eventId: string) => Promise<readonly TaskAssignmentItem[]>

  /**
   * The Tasks table itself. Distinct from the two reads above rather than derivable from
   * them: they resolve a task from an assignment, so a task an organizer has defined and
   * not yet assigned does not appear, and that is the state the admin Tasks list exists to
   * show.
   */
  listTasksForEvent: (eventId: string) => Promise<readonly Task[]>

  /**
   * File requests, and the assignments against them. R6, BUILD_SPEC 5.6.
   *
   * Three reads for the same reason Tasks needs three: the list read shows a request an
   * organizer has defined and not yet assigned, which a read that resolves a request FROM an
   * assignment cannot show, and the admin and portal graphs differ only in their scope and
   * their cache tags.
   */
  listFileRequests: (eventId: string) => Promise<readonly FileRequest[]>
  listFileRequestAssignmentsForEvent: (eventId: string) => Promise<readonly FileRequestItem[]>
  listFileRequestAssignmentsForSpeaker: (
    eventId: string,
    speakerId: string,
  ) => Promise<readonly FileRequestItem[]>

  /**
   * Files, by owner, by submission, and by the event's roster. All three return
   * `objectKey` and never a URL: a public link is derived at read time and a private one
   * is served through an authenticated route, so the serving decision belongs to the
   * route (section 5.2).
   *
   * The third one takes the roster because that is the only way to scope Files to an
   * event: the table has no event link, so `eventId` names the cache tag and the speaker
   * ids do the filtering.
   */
  listFilesForSpeaker: (speakerId: string) => Promise<readonly StoredFile[]>
  listFilesForSubmission: (submissionId: string) => Promise<readonly StoredFile[]>
  listFilesForEventSpeakers: (
    eventId: string,
    speakerIds: readonly string[],
  ) => Promise<readonly StoredFile[]>

  /**
   * The event's resource pages, and the PortalItems rows that publish them. R8.
   *
   * Two reads rather than one joined read, and the join lives in
   * `@/features/resources/pages` instead. The admin list needs unpublished pages and the
   * portal needs only published ones, so a joined read would have to serve both and the
   * visibility rule would end up inside the DAL, where it cannot be unit tested against
   * the cross-event cases that matter.
   */
  listResources: (eventId: string) => Promise<readonly Resource[]>
  listPortalItems: (eventId: string) => Promise<readonly PortalItem[]>

  /**
   * The event's stored email bodies, for Settings > Email Templates and the builder's admin
   * notifications panel.
   *
   * Behind the port like every other READ, so a clone with no base renders the page instead
   * of throwing `CFG_ENV_MISSING` from `getClient()`. On fixtures it is empty, which is the
   * honest answer and the right one: no row stored means every template is the built-in
   * body, which is exactly what a fresh event looks like.
   *
   * The WRITE path does not come through here. `upsertEmailTemplate` reads uncached, on
   * purpose (reads-comms.ts), and a write needs a base regardless.
   */
  listEmailTemplates: (eventId: string) => Promise<readonly EmailTemplate[]>

  /**
   * The event's CMS embeds, and one embed by the id in its public URL. R9.
   *
   * Two reads for the same reason Forms needs two: the admin list is addressed by event id,
   * the served feed is addressed by the opaque `publicId` a stranger's website holds, and the
   * two are therefore separate cache entries with separate tags (tags-cms.ts). The list is
   * unfiltered by `enabled` because ref 32's segmented filter counts the disabled rows, and
   * the public read returns `undefined` for an unknown id because the route turns that into a
   * 404 rather than an error.
   */
  listCmsEmbeds: (eventId: string) => Promise<readonly CmsEmbed[]>
  getCmsEmbedByPublicId: (publicId: string) => Promise<CmsEmbed | undefined>

  /**
   * The saved views on one list surface of one event. R1/R4 presentation, ref 19.
   *
   * Scoped by surface here rather than filtered by the caller, because the surface is what
   * makes two views distinct: an Abstracts view and an Agenda List view can carry the same
   * name and the same column keys, and a read that returned both would put each in the
   * other's dropdown. Unsorted: the order is a rule (`sortSavedViews`), so it holds for the
   * fixture path too instead of depending on Airtable's record order.
   */
  listSavedViews: (eventId: string, surface: SavedViewSurface) => Promise<readonly SavedView[]>

  /** Identity resolution for the magic-link flow. Absent is a normal answer. */
  findAdminUserByEmail: (email: string) => Promise<AdminUser | undefined>
  findSpeakerByEmail: (email: string) => Promise<Speaker | undefined>

  /**
   * Speakers across several events at once, for the cross-event CRM directory.
   *
   * Takes the viewer's whole membership set rather than one event, which is what makes
   * this "cross-event": `listSpeakers` above answers one event, this answers the union of
   * however many events the caller is allowed to see.
   */
  listSpeakersForEvents: (eventIds: readonly string[]) => Promise<readonly Speaker[]>

  /**
   * The same roster, keeping each speaker's links to the asked-for events.
   *
   * What the CRM directory reads, because it needs the Events count and the links are
   * already in the records the read above pages through. Asking per event instead is the
   * same whole-table scan once more per event, under a different cache key.
   */
  listSpeakersInEvents: (eventIds: readonly string[]) => Promise<readonly SpeakerInEvents[]>

  /** The global speaker tag vocabulary, not scoped to any one event. */
  listSpeakerTags: () => Promise<readonly SpeakerTag[]>

  /** One user's saved speaker filters: the CRM directory's list picker. */
  listSpeakerLists: (userId: string) => Promise<readonly SpeakerList[]>

  /** One speaker's sent mail, across every event, for the CRM timeline. */
  listOutboxForSpeaker: (speakerId: string) => Promise<readonly OutboxRow[]>

  /** The tag ids applied to one speaker, for the CRM profile's tag chips. */
  listSpeakerTagIds: (speakerId: string) => Promise<readonly string[]>

  /**
   * Every speaker's tag ids, keyed by speaker, from one read. What the cross-event
   * directory needs: it renders, filters and sorts on tags across the whole membership
   * set, and asking per row would be one Airtable request per row.
   */
  listSpeakerTagMembership: () => Promise<ReadonlyMap<string, readonly string[]>>
}
