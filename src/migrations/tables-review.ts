// The event-scoped lookups and the whole review graph.
//
// Rooms, Tracks, Tags, AdminUsers, EventMemberships, EvaluationPlans, Rounds,
// ReviewTeams, ReviewTeamMembers, SubmissionRounds, ReviewAssignments, Reviews.
// Split from tables-core.ts for the file-size limit; the primary-field rule
// explained there applies here too, which is why every join table leads with its
// timestamp: `addedAt`, `enteredAt`, `assignedAt`, `updatedAt`.
//
// The uniqueness constraints section 3 states for these tables (ReviewTeamMembers,
// SubmissionRounds, ReviewAssignments) are NOT declared here, because Airtable has
// no unique index and the schema cannot express one. They are enforced in the
// mutations, which is what src/migrations/README.md already says.

import { EVENT_ROLES, REVIEW_RECOMMENDATIONS, SUBMISSION_ROUND_STATUSES } from '@/constants/status'
import {
  checkboxField,
  dateTimeField,
  emailField,
  link,
  longText,
  numberField,
  select,
  type TableSpec,
  text,
} from '@/migrations/schema-types'
import { COL, TABLES } from '@/services/airtable/tables'
import { AI_PRESCREEN_STATUSES } from '@/types/prescreen'

const PLAN_STATUSES = ['draft', 'active', 'closed']
const ASSIGNMENT_SOURCES = ['routing', 'manual', 'team']
const SAVED_VIEW_SURFACES = ['abstracts', 'sessions', 'forms', 'tasks']

const rooms: TableSpec = {
  name: TABLES.rooms,
  fields: [
    text(COL.name),
    link(COL.event, TABLES.events),
    numberField(COL.capacity),
    numberField(COL.order),
  ],
}

const tracks: TableSpec = {
  name: TABLES.tracks,
  fields: [
    text(COL.name),
    link(COL.event, TABLES.events),
    // Text and not a select: `mapTrack` falls back to a neutral grey, and a colour
    // picker whose choices are fixed at migration time cannot serve an organizer
    // adding a fifth track.
    text(COL.color),
    numberField(COL.order),
  ],
}

const tags: TableSpec = {
  name: TABLES.tags,
  fields: [text(COL.name), link(COL.event, TABLES.events), text(COL.color)],
}

const adminUsers: TableSpec = {
  name: TABLES.adminUsers,
  // No role column, on purpose. Roles are event-scoped and live in
  // EventMemberships, so that "reviewer here, admin there" is representable at all.
  fields: [emailField(COL.email), text(COL.name)],
}

const eventMemberships: TableSpec = {
  name: TABLES.eventMemberships,
  fields: [
    dateTimeField(COL.addedAt),
    link(COL.event, TABLES.events),
    link(COL.user, TABLES.adminUsers),
    select(COL.role, EVENT_ROLES),
  ],
}

const evaluationPlans: TableSpec = {
  name: TABLES.evaluationPlans,
  fields: [
    text(COL.name),
    link(COL.event, TABLES.events),
    select(COL.status, PLAN_STATUSES),
    dateTimeField(COL.createdAt),
  ],
}

const rounds: TableSpec = {
  name: TABLES.rounds,
  fields: [
    text(COL.name),
    link(COL.plan, TABLES.evaluationPlans),
    // Denormalised so a round can be scoped to an event without a join through the
    // plan. Section 3 asks for it explicitly.
    link(COL.event, TABLES.events),
    numberField(COL.order),
    longText(COL.criteriaJson),
    // Per-round settings. Dates are advisory: nothing refuses a review filed late,
    // because a committee that runs a day over is normal and locking them out of the
    // form is how the scores end up in a spreadsheet instead.
    dateTimeField(COL.startsAt),
    dateTimeField(COL.endsAt),
    checkboxField(COL.anonymous),
    // The round's reviewer pool. EMPTY MEANS EVERYONE on the event: every round that
    // existed before this column has it empty, and reading that as "nobody" would
    // empty every committee the moment the migration ran.
    link(COL.reviewers, TABLES.adminUsers),
    // The per-reviewer ceiling. EMPTY MEANS NO CEILING, for the same reason the pool
    // above reads empty as everyone: every round that predates the column has it blank,
    // and reading blank as zero would stop auto-distribution assigning anything at all.
    numberField(COL.maxPerReviewer),
  ],
}

const reviewTeams: TableSpec = {
  name: TABLES.reviewTeams,
  fields: [text(COL.name), link(COL.event, TABLES.events), longText(COL.description)],
}

const reviewTeamMembers: TableSpec = {
  name: TABLES.reviewTeamMembers,
  fields: [
    dateTimeField(COL.addedAt),
    link(COL.team, TABLES.reviewTeams),
    link(COL.user, TABLES.adminUsers),
  ],
}

const submissionRounds: TableSpec = {
  name: TABLES.submissionRounds,
  fields: [
    dateTimeField(COL.enteredAt),
    link(COL.submission, TABLES.submissions),
    link(COL.round, TABLES.rounds),
    select(COL.status, SUBMISSION_ROUND_STATUSES),
    dateTimeField(COL.decidedAt),
  ],
}

const reviewAssignments: TableSpec = {
  name: TABLES.reviewAssignments,
  fields: [
    dateTimeField(COL.assignedAt),
    link(COL.submission, TABLES.submissions),
    link(COL.round, TABLES.rounds),
    link(COL.reviewer, TABLES.adminUsers),
    link(COL.viaTeam, TABLES.reviewTeams),
    select(COL.source, ASSIGNMENT_SOURCES),
  ],
}

const reviews: TableSpec = {
  name: TABLES.reviews,
  fields: [
    dateTimeField(COL.updatedAt),
    link(COL.submission, TABLES.submissions),
    link(COL.round, TABLES.rounds),
    link(COL.reviewer, TABLES.adminUsers),
    longText(COL.scoresJson),
    // Answers to free-text criteria, keyed by criterion. Separate from `scoresJson`,
    // which is numbers all the way down to its Zod schema, and from `comment`, which
    // is one note about the submission rather than one per criterion.
    longText(COL.notesJson),
    // A recused review is a row that exists to say the reviewer will not score this one.
    // It has to be a row rather than a deleted assignment: the assignment is what the
    // chair made, and removing it would lose the fact that this person was asked.
    checkboxField(COL.recused),
    longText(COL.comment),
    select(COL.recommendation, REVIEW_RECOMMENDATIONS),
  ],
}

const savedViews: TableSpec = {
  name: TABLES.savedViews,
  fields: [
    text(COL.name),
    link(COL.event, TABLES.events),
    select(COL.surface, SAVED_VIEW_SURFACES),
    link(COL.owner, TABLES.adminUsers),
    longText(COL.columnsJson),
    longText(COL.sortJson),
    longText(COL.filterJson),
    checkboxField(COL.isDefault),
  ],
}

/**
 * The AI pre-screen queue (BUILD_SPEC 5.4).
 *
 * Shaped like `SyncLog` in tables-comms.ts, which is this base's existing precedent for a
 * job-and-failure log: an event link to scope it, the two links that identify the work, a
 * status, an attempt count and the last error. It leads with `queuedAt` for the same
 * reason every join table here leads with its timestamp, which is that Airtable's primary
 * field cannot be a link or a select.
 *
 * There is no lease column, and that asymmetry with `EmailOutbox` is deliberate. Those two
 * columns RECORD a claim rather than granting one, and this queue is claimed through
 * `claimOnce()` alone: the drain re-reads the row on the next tick anyway, so a second
 * copy of the lease in Airtable would be state that can only ever disagree with the
 * Durable Object that actually decides.
 */
const aiPrescreenJobs: TableSpec = {
  name: TABLES.aiPrescreenJobs,
  fields: [
    dateTimeField(COL.queuedAt),
    link(COL.event, TABLES.events),
    link(COL.round, TABLES.rounds),
    link(COL.submission, TABLES.submissions),
    select(COL.status, AI_PRESCREEN_STATUSES),
    numberField(COL.attempts),
    longText(COL.error),
    dateTimeField(COL.startedAt),
    dateTimeField(COL.finishedAt),
    // Set when a run finishes, so a live run can supersede a sample one. Without it a
    // round demonstrated under the default `AI_MOCK=1` carries reviews and done rows
    // indistinguishable from real ones, and adding a key re-scores nothing.
    checkboxField(COL.mocked),
  ],
}

export const REVIEW_TABLES: readonly TableSpec[] = [
  rooms,
  tracks,
  tags,
  adminUsers,
  eventMemberships,
  evaluationPlans,
  rounds,
  reviewTeams,
  reviewTeamMembers,
  submissionRounds,
  reviewAssignments,
  reviews,
  savedViews,
  aiPrescreenJobs,
]
