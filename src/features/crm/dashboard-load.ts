// The CRM dashboard's reads, and nothing else. The rules are in `dashboard.ts`.
//
// Every read here is one the directory already performs, under the same cache tags and the
// same windows, so an organizer arriving from `/admin/crm` pays for none of them again:
// `listSpeakersInEvents` (the roster and the event links), one `listSubmissions` per event
// (the session casts), and the two speaker-tag reads. `getEvent` per event is the one
// addition, and it is the same `event:{id}` entry the sidebar and every event screen read.
//
// The per-event fan-out is the shape `directory.ts` documents: one read per event the viewer
// belongs to, issued in parallel, plus the flat ones. Not a loop of per-speaker lookups,
// which is what `scheduler.ts` exists to prevent.

import { buildCrmDashboard, type CrmDashboardView } from '@/features/crm/dashboard'
import { tagsBySpeaker } from '@/features/crm/directory'
import { findDuplicateClusters } from '@/features/crm/duplicates'
import type { CrmScope } from '@/features/crm/scope'
import { type SpeakerEventSessions, sessionCounts } from '@/features/crm/speaker-rows'
import {
  getEvent,
  listSpeakersInEvents,
  listSpeakerTagMembership,
  listSpeakerTags,
  listSubmissions,
} from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'

async function eventSessions(eventId: RecordId): Promise<SpeakerEventSessions> {
  const submissions = await listSubmissions(eventId)
  return {
    eventId,
    sessionCasts: submissions.map((submission) =>
      submission.participants.map((participant) => participant.speaker.id),
    ),
  }
}

/**
 * The dashboard, for one viewer's scope.
 *
 * `now` is passed through rather than read inside the aggregation, so the trailing invitation
 * window is a property of the request and the rules stay testable against a fixed date.
 */
export async function loadCrmDashboard(scope: CrmScope): Promise<CrmDashboardView> {
  const [speakers, activity, vocabulary, membership, events] = await Promise.all([
    listSpeakersInEvents(scope.eventIds),
    Promise.all(scope.eventIds.map(eventSessions)),
    listSpeakerTags(),
    listSpeakerTagMembership(),
    Promise.all(scope.eventIds.map(async (eventId) => await getEvent(eventId))),
  ])

  return buildCrmDashboard({
    speakers,
    sessionCounts: sessionCounts(activity),
    tagsBySpeaker: tagsBySpeaker(membership, vocabulary),
    eventNames: new Map(events.map((event) => [event.id, event.name])),
    // The same rule the directory badges rows with, so the dashboard's duplicate count and
    // the directory's `Duplicates N` control can never disagree about the number.
    clusters: findDuplicateClusters(speakers.map((entry) => entry.speaker)),
    now: new Date(),
  })
}
