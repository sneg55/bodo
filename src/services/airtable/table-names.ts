// Airtable's own table names, and nothing else.
//
// Split from ./tables.ts, which holds the column registry, when the two together crossed
// the file-size budget. The seam is real rather than arbitrary: a table name is used by
// the migration, the seed and every DAL call, while a column name is used only by the
// mappers, so the two lists are read by different code and grow for different reasons.
//
// `tables.ts` re-exports both, so every existing `import { COL, TABLES }` still resolves
// and no call site had to change.

export const TABLES = {
  events: 'Events',
  forms: 'Forms',
  submissions: 'Submissions',
  submissionParticipants: 'SubmissionParticipants',
  speakers: 'Speakers',
  files: 'Files',
  evaluationPlans: 'EvaluationPlans',
  rounds: 'Rounds',
  reviewTeams: 'ReviewTeams',
  reviewTeamMembers: 'ReviewTeamMembers',
  submissionRounds: 'SubmissionRounds',
  reviewAssignments: 'ReviewAssignments',
  reviews: 'Reviews',
  adminUsers: 'AdminUsers',
  eventMemberships: 'EventMemberships',
  rooms: 'Rooms',
  tracks: 'Tracks',
  tags: 'Tags',
  tasks: 'Tasks',
  taskAssignments: 'TaskAssignments',
  fileRequests: 'FileRequests',
  fileRequestAssignments: 'FileRequestAssignments',
  portals: 'Portals',
  portalItems: 'PortalItems',
  savedViews: 'SavedViews',
  emailTemplates: 'EmailTemplates',
  emailOutbox: 'EmailOutbox',
  resources: 'Resources',
  integrationMappings: 'IntegrationMappings',
  syncLog: 'SyncLog',
  importRuns: 'ImportRuns',
  cmsEmbeds: 'CmsEmbeds',
  dashboards: 'Dashboards',
  dashboardWidgets: 'DashboardWidgets',
  // Who changed what, and when. Not in BUILD_SPEC section 3: added because a content
  // edit that leaves no trace is indistinguishable from no edit, and an organizer who
  // finds a session retitled has no way to ask why. One row per FIELD changed rather
  // than per save, so the history reads as a list of facts rather than a diff nobody
  // renders.
  contentRevisions: 'ContentRevisions',
  aiPrescreenJobs: 'AiPrescreenJobs',
  // Organizer notes ON a file. Not in BUILD_SPEC section 3: added because a chair asking
  // "can you re-export this without the speaker notes" had nowhere to say it, so the
  // conversation happened in email and the next version arrived with no record of why.
  fileComments: 'FileComments',
  // The Speaker CRM's two cross-event tables (R11). A tag is a label on a speaker that
  // outlives any one event, and a list is a saved DEFINITION rather than a snapshot of
  // members, so re-opening one re-runs it instead of showing who matched last month.
  speakerTags: 'SpeakerTags',
  speakerLists: 'SpeakerLists',
  // The CRM's two append-only logs about a PERSON, added with the sourcing pipeline.
  //
  // Both are cross-event for the same reason the tag vocabulary is: what they record is a
  // fact about the contact rather than about one conference. An internal note follows the
  // person to next year's event, and `Speakers.status` is one column on the Speakers row,
  // so its history cannot be per event without inventing a second status that does not
  // exist. Neither table carries an `event` link, and that absence is the design.
  speakerNotes: 'SpeakerNotes',
  speakerStageHistory: 'SpeakerStageHistory',
  // R10's bearer credentials (BUILD_SPEC section 3, "ApiTokens (P2)"). Declared here and in
  // `src/migrations/tables-api.ts` in the same change, deliberately: `001-initial-schema.ts`
  // skipped this table for exactly one reason, that the migration would otherwise name a
  // table this registry did not, and the two have to arrive together or that stays true.
  //
  // No `event` link. A token is issued against the ORGANIZATION and its reach is decided by
  // the memberships of the admin user who created it, so scoping the row to one event would
  // make a second event's token a second row for the same person and the same access.
  apiTokens: 'ApiTokens',
  // Outbound webhooks, and their delivery queue. Two tables for the reason EmailTemplates and
  // EmailOutbox are two: one is the standing SUBSCRIPTION an organizer configures, the other
  // is one attempt to deliver one event to it, with its own lease, attempts and last error.
  //
  // `WebhookDeliveries` is a sibling of `EmailOutbox` rather than a widening of it. Widening
  // would put webhook rows on the path that carries R3's calendar invites and acceptance mail,
  // which already works and has idempotency guarantees worth not disturbing.
  webhooks: 'Webhooks',
  webhookDeliveries: 'WebhookDeliveries',
} as const

export type TableName = (typeof TABLES)[keyof typeof TABLES]
