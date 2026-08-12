// The portal's composed reads: the acting speaker, and their own data.
//
// Every function here reads the session cookie and then Airtable, so a portal page calls
// them from inside a `<Suspense>` boundary. That is now a streaming choice rather than a
// build requirement: the card frames and the pill nav flush first and the rows arrive when
// the reads finish. Calling one of these in a page body is legal, it just makes the whole
// page wait on Airtable before anything paints.
//
// The Airtable half of each read is cached and tagged, because it goes through
// `@/services/airtable/queries`. Only the "who is asking" part is per request, which
// is why the whole event's submission list is fetched and filtered here rather than
// queried per speaker: one cached, tagged read serves every speaker's portal instead
// of one uncacheable read per visitor.

import { requireSpeaker } from '@/features/auth/wiring'
import { portalEventId, portalEventIds } from '@/features/portal/event-scope'
import { type PortalUser, portalUserOf } from '@/features/portal/identity'
import { ownSubmissions } from '@/features/portal/own-submissions'
import { type PortalTaskItem, portalDataPort } from '@/features/portal/ports'
import {
  getEvent,
  getSpeaker,
  listFileRequestAssignmentsForSpeaker,
  listFilesForSpeaker,
  listForms,
  listSubmissionsForEvents,
} from '@/services/airtable/queries'
import type { FileRequestItem } from '@/services/airtable/reads-requests'
import type {
  Event,
  RecordId,
  Speaker,
  StoredFile,
  SubmissionWithParticipants,
} from '@/types/domain'
import type { Form } from '@/types/forms'

export type PortalSession = {
  speakerId: RecordId
  speaker: Speaker
  user: PortalUser
  /**
   * The CONFIGURED event, from `portalEventId()`, and never the speaker's scope.
   *
   * It is the deployment's landing context and nothing more. Do not read it to decide what
   * a speaker may see or write: that is `portalEventIds(speakerId)`, which is the
   * authorization boundary, and reading a configured event in its place is what broke
   * `Mark complete` for every task outside it (see ./own-assignment.ts). No caller of this
   * function reads this field today, which is the state it should stay in.
   */
  eventId: RecordId
  /**
   * True when an organizer entered this session through the admin bar's View Portal
   * control. Read from the session token's own claim and never from a query parameter, so
   * `Back to Admin Mode` cannot be faked into a real speaker's menu.
   */
  impersonating: boolean
}

/** The acting speaker plus everything the chrome and the profile page need. */
export async function portalSession(): Promise<PortalSession> {
  const { speakerId, impersonatorUserId } = await requireSpeaker()
  const speaker = await getSpeaker(speakerId)
  return {
    speakerId,
    speaker,
    user: portalUserOf(speaker),
    eventId: portalEventId(),
    impersonating: impersonatorUserId !== undefined,
  }
}

export type OwnSubmissions = {
  speakerId: RecordId
  submissions: readonly SubmissionWithParticipants[]
  /**
   * Every form across the speaker's events, so a card can name the session type.
   *
   * Carried on the result rather than fetched beside it, which is what the two surfaces
   * that render these rows used to do: both called `listForms(portalEventId())`, so a
   * submission from any other event resolved to no form and lost its type label. Reading it
   * here also means the forms and the submissions can never be scoped differently.
   */
  forms: readonly Form[]
  /**
   * `eventId -> event name`, and the reason a portal that spans events needs it: two rows
   * reading "Accepted" mean different things at different conferences, so a card has to be
   * able to say which one. Only rendered when the speaker is in more than one, per
   * `showsEventNames` below.
   */
  eventNames: ReadonlyMap<RecordId, string>
}

/**
 * Whether a submission row should name its event.
 *
 * A single-event speaker is the common case and the one the parity docs describe, and
 * stamping every card with the only conference they are in is noise. The label appears
 * exactly when it disambiguates.
 */
export function showsEventNames(own: Pick<OwnSubmissions, 'eventNames'>): boolean {
  return own.eventNames.size > 1
}

/**
 * The acting speaker's own submissions, newest first, ACROSS EVERY EVENT they belong to.
 *
 * One read for the whole scope rather than one per event: `listSubmissionsForEvents` scans
 * the three tables once and tags the entry with every event's tags, so a speaker in three
 * conferences costs what a speaker in one costs. See that function for why the tags have to
 * be a union rather than a wildcard.
 */
export async function readOwnSubmissions(): Promise<OwnSubmissions> {
  const { speakerId } = await requireSpeaker()
  const eventIds = await portalEventIds(speakerId)

  const [all, formsPerEvent, events] = await Promise.all([
    listSubmissionsForEvents(eventIds),
    // Per event, because `listForms` is tagged `event:{id}:forms` and there is no
    // cross-event forms read. One cached call per event a speaker is actually in, which is
    // one in the ordinary case, and each is an entry the admin Forms screen already warms.
    Promise.all(eventIds.map((eventId) => listForms(eventId))),
    Promise.all(eventIds.map((eventId) => getEvent(eventId))),
  ])

  return {
    speakerId,
    submissions: ownSubmissions(all, speakerId),
    forms: formsPerEvent.flat(),
    eventNames: new Map(events.map((event) => [event.id, event.name])),
  }
}

export type OwnSubmissionDetail = {
  speakerId: RecordId
  submission: SubmissionWithParticipants
  /** The form it came through, absent for a manual submission. */
  form?: Form
  event: Event
  files: readonly StoredFile[]
  tasks: readonly PortalTaskItem[]
}

/**
 * One submission by the code the portal shows the speaker, or undefined when it is
 * not theirs.
 *
 * Undefined and not-found are deliberately the same answer. Telling a speaker that
 * SESS-9 exists but belongs to somebody else hands them a fact about another person's
 * work, and the page renders the same not-found either way.
 */
export async function readOwnSubmissionByCode(
  code: string,
): Promise<OwnSubmissionDetail | undefined> {
  const { speakerId } = await requireSpeaker()
  const own = ownSubmissions(
    await listSubmissionsForEvents(await portalEventIds(speakerId)),
    speakerId,
  )
  const submission = own.find((row) => row.code === code)
  if (submission === undefined) return undefined

  // The SUBMISSION'S event, not the portal's. Reading the configured one here is what made
  // /portal/submissions/SESS-35 answer 404 for a proposal that existed and belonged to the
  // person asking: the code resolved against one event's list and everything below it was
  // then loaded for a different conference.
  const eventId = submission.eventId

  const [event, forms, files, tasks] = await Promise.all([
    getEvent(eventId),
    listForms(eventId),
    portalDataPort().listSubmissionFiles({ submissionId: submission.id }),
    portalDataPort().listTaskAssignments({ eventId, speakerId }),
  ])

  return {
    speakerId,
    submission,
    form: forms.find((candidate) => candidate.id === submission.formId),
    event,
    files,
    tasks,
  }
}

export type OwnTasks = {
  speakerId: RecordId
  items: readonly PortalTaskItem[]
  /**
   * The speaker's own uploads, so a COMPLETED upload task can name the file it received.
   * One cached read tagged `speaker:{id}:files` covers every row, the same way
   * `readOwnRequestedFiles` does it rather than one read per task.
   */
  files: readonly StoredFile[]
}

export type OwnRequestedFiles = {
  speakerId: RecordId
  items: readonly FileRequestItem[]
  /**
   * The speaker's own `Files` rows, so a delivered request can name what arrived. Read here
   * rather than per request: one cached read tagged `speaker:{id}:files` covers every row,
   * and a read per assignment is the per-row fan-out BUILD_SPEC 3.1 warns about.
   */
  files: readonly StoredFile[]
}

/**
 * What an organizer has asked this speaker to upload, and what they have delivered.
 *
 * Across every event, for the same reason the submissions list is: a speaker accepted at two
 * conferences owes both of them their slides, and scoping this to `PORTAL_EVENT_ID` showed
 * them one organizer's requests and silently hid the other's.
 *
 * A read PER EVENT rather than one widened read, unlike the submissions above, and the
 * difference is not an inconsistency. That read is one whole-table scan either way, so
 * widening it was free. This one is tagged `event:{id}:file-requests` and there is no
 * cross-event form of it, so the honest options were N correctly tagged reads or one read
 * nothing could invalidate. N is the one that keeps the rule. It is one call in the ordinary
 * case.
 */
export async function readOwnRequestedFiles(): Promise<OwnRequestedFiles> {
  const { speakerId } = await requireSpeaker()
  const eventIds = await portalEventIds(speakerId)

  const [perEvent, files] = await Promise.all([
    Promise.all(
      eventIds.map((eventId) => listFileRequestAssignmentsForSpeaker(eventId, speakerId)),
    ),
    listFilesForSpeaker(speakerId),
  ])

  return { speakerId, items: perEvent.flat(), files }
}

/** The speaker's to-dos, across every event they are on. Same reasoning as above. */
export async function readOwnTasks(): Promise<OwnTasks> {
  const { speakerId } = await requireSpeaker()
  const eventIds = await portalEventIds(speakerId)

  const [perEvent, files] = await Promise.all([
    Promise.all(
      eventIds.map((eventId) => portalDataPort().listTaskAssignments({ eventId, speakerId })),
    ),
    listFilesForSpeaker(speakerId),
  ])

  return { speakerId, items: perEvent.flat(), files }
}
