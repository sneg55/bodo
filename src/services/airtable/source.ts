// The one branch between "there is an Airtable base" and "serve the fixtures".
//
// `hasAirtable()` is false on a fresh clone with an empty `.env`, and the app still
// has to boot, navigate and demo, so the fixtures in ./fixtures are served instead
// of calling out. That decision is made exactly once, in `getSource()`. Nothing
// else in this directory, and nothing at all outside it, asks the question again:
// a read that checks for credentials itself is a read that will eventually check
// differently from its neighbour.
//
// The fixture half lives in ./source-fixtures.ts, moved there when this file reached its
// size budget (the precedent is queries-portal.ts, split out of queries.ts for the same
// reason). It is honest about being read-only. Mutations do not come through here; they
// call the client directly and fail with CFG_ENV_MISSING when there is no base, because a
// write that quietly goes nowhere looks like success and loses a speaker's submission.

import type { DataSource } from '@/services/airtable/data-source'
import * as live from '@/services/airtable/reads'
import * as cms from '@/services/airtable/reads-cms'
import * as comms from '@/services/airtable/reads-comms'
import * as crm from '@/services/airtable/reads-crm'
import * as files from '@/services/airtable/reads-files'
import * as identity from '@/services/airtable/reads-identity'
import * as portal from '@/services/airtable/reads-portal'
import * as requests from '@/services/airtable/reads-requests'
import * as resources from '@/services/airtable/reads-resources'
import * as review from '@/services/airtable/reads-review'
import * as savedViews from '@/services/airtable/reads-saved-views'
import * as tasks from '@/services/airtable/reads-tasks'
import { fixtureSource } from '@/services/airtable/source-fixtures'
import { hasAirtable } from '@/utils/env'

const airtableSource: DataSource = {
  getEvent: live.getEvent,
  getEventBySlug: live.getEventBySlug,
  listSubmissions: live.listSubmissions,
  listSubmissionsForEvents: live.listSubmissionsForEvents,
  getSubmission: live.getSubmission,
  getSubmissionByCode: live.getSubmissionByCode,
  listForms: live.listForms,
  getFormByPublicId: live.getFormByPublicId,
  listTracks: review.listTracks,
  listTags: review.listTags,
  listRooms: review.listRooms,
  listSpeakers: review.listSpeakers,
  getSpeaker: review.getSpeaker,
  listAssignmentsForReviewer: review.listAssignmentsForReviewer,
  getActivePlan: review.getActivePlan,
  listRoundsForActivePlan: review.listRoundsForActivePlan,
  listEvaluationPlans: review.listEvaluationPlans,
  listRounds: review.listRounds,
  listTaskAssignmentsForSpeaker: portal.listTaskAssignmentsForSpeaker,
  listTaskAssignmentsForEvent: portal.listTaskAssignmentsForEvent,
  listTasksForEvent: tasks.listTasksForEvent,
  listFileRequests: requests.listFileRequests,
  listFileRequestAssignmentsForEvent: requests.listFileRequestAssignmentsForEvent,
  listFileRequestAssignmentsForSpeaker: requests.listFileRequestAssignmentsForSpeaker,
  listFilesForSpeaker: files.listFilesForSpeaker,
  listFilesForSubmission: files.listFilesForSubmission,
  listFilesForEventSpeakers: files.listFilesForEventSpeakers,
  listEmailTemplates: comms.listEmailTemplates,
  listResources: resources.listResources,
  listPortalItems: resources.listPortalItems,
  listCmsEmbeds: cms.listCmsEmbeds,
  getCmsEmbedByPublicId: cms.getCmsEmbedByPublicId,
  listSavedViews: savedViews.listSavedViews,
  listMembershipsForUser: identity.listMembershipsForUser,
  findAdminUserByEmail: identity.findAdminUserByEmail,
  findSpeakerByEmail: identity.findSpeakerByEmail,
  listSpeakersForEvents: crm.listSpeakersForEvents,
  listSpeakersInEvents: crm.listSpeakersInEvents,
  listSpeakerTags: crm.listSpeakerTags,
  listSpeakerLists: crm.listSpeakerLists,
  listOutboxForSpeaker: crm.listOutboxForSpeaker,
  listSpeakerTagIds: crm.listSpeakerTagIds,
  listSpeakerTagMembership: crm.listSpeakerTagMembership,
}

export function getSource(): DataSource {
  return hasAirtable() ? airtableSource : fixtureSource
}
