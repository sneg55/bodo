// Mappers for the small event-scoped tables and the review graph.
//
// Split from mapping.ts to keep both files well under the 300-line limit. Same
// rules apply: link fields collapse to ids, JSON blobs are validated, and a
// failure names the record.

import { EVENT_ROLES, REVIEW_RECOMMENDATIONS, SUBMISSION_ROUND_STATUSES } from '@/constants/status'
import {
  type AirtableRecord,
  checkbox,
  choiceOr,
  jsonBlob,
  linkIds,
  numberOr,
  optionalChoice,
  optionalLink,
  optionalNumber,
  optionalText,
  requiredChoice,
  requiredLink,
  text,
  view,
} from '@/services/airtable/records'
import { criteriaSchema, criterionNotesSchema, scoresSchema } from '@/services/airtable/schemas'
import { COL, TABLES } from '@/services/airtable/tables'
import type {
  AdminUser,
  EvaluationPlan,
  EventMembership,
  Review,
  ReviewAssignment,
  ReviewTeam,
  Room,
  Round,
  SubmissionRound,
  Tag,
  Track,
} from '@/types/domain'

export function mapTrack(record: AirtableRecord): Track {
  const source = view(TABLES.tracks, record)
  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    name: text(source, COL.name),
    // A chip with no colour still has to render, so a blank column is a neutral
    // grey rather than an error that takes the whole filter bar down.
    color: optionalText(source, COL.color) ?? '#64748b',
    order: numberOr(source, COL.order, 0),
  }
}

export function mapTag(record: AirtableRecord): Tag {
  const source = view(TABLES.tags, record)
  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    name: text(source, COL.name),
    color: optionalText(source, COL.color) ?? '#64748b',
  }
}

export function mapRoom(record: AirtableRecord): Room {
  const source = view(TABLES.rooms, record)
  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    name: text(source, COL.name),
    capacity: optionalNumber(source, COL.capacity),
    order: numberOr(source, COL.order, 0),
  }
}

export function mapAdminUser(record: AirtableRecord): AdminUser {
  const source = view(TABLES.adminUsers, record)
  return {
    id: source.id,
    email: text(source, COL.email),
    name: optionalText(source, COL.name) ?? '',
  }
}

export function mapMembership(record: AirtableRecord): EventMembership {
  const source = view(TABLES.eventMemberships, record)
  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    userId: requiredLink(source, COL.user),
    // No default: a membership row with no role decides nothing, and guessing
    // `admin` would hand out capability that nobody granted.
    role: requiredChoice(source, COL.role, EVENT_ROLES),
    addedAt: optionalText(source, COL.addedAt) ?? '',
  }
}

export function mapPlan(record: AirtableRecord): EvaluationPlan {
  const source = view(TABLES.evaluationPlans, record)
  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    name: text(source, COL.name),
    status: choiceOr(source, COL.status, ['draft', 'active', 'closed'] as const, 'draft'),
  }
}

export function mapRound(record: AirtableRecord): Round {
  const source = view(TABLES.rounds, record)
  return {
    id: source.id,
    planId: requiredLink(source, COL.plan),
    eventId: requiredLink(source, COL.event),
    name: text(source, COL.name),
    order: numberOr(source, COL.order, 0),
    criteria: jsonBlob(source, COL.criteriaJson, criteriaSchema, []),
    startsAt: optionalText(source, COL.startsAt),
    endsAt: optionalText(source, COL.endsAt),
    anonymous: checkbox(source, COL.anonymous),
    reviewerIds: linkIds(source, COL.reviewers),
    // Optional, not `numberOr(..., 0)`: a blank column is "no ceiling" and 0 is a real
    // ceiling an organizer can set. Collapsing them would make every pre-existing round
    // refuse every assignment.
    maxPerReviewer: optionalNumber(source, COL.maxPerReviewer),
  }
}

export function mapReviewTeam(record: AirtableRecord): ReviewTeam {
  const source = view(TABLES.reviewTeams, record)
  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    name: text(source, COL.name),
    description: optionalText(source, COL.description),
  }
}

export function mapReviewAssignment(record: AirtableRecord): ReviewAssignment {
  const source = view(TABLES.reviewAssignments, record)
  return {
    id: source.id,
    submissionId: requiredLink(source, COL.submission),
    roundId: requiredLink(source, COL.round),
    reviewerId: requiredLink(source, COL.reviewer),
    viaTeamId: optionalLink(source, COL.viaTeam),
    assignedAt: optionalText(source, COL.assignedAt) ?? '',
    source: choiceOr(source, COL.source, ['routing', 'manual', 'team'] as const, 'manual'),
  }
}

export function mapSubmissionRound(record: AirtableRecord): SubmissionRound {
  const source = view(TABLES.submissionRounds, record)
  return {
    id: source.id,
    submissionId: requiredLink(source, COL.submission),
    roundId: requiredLink(source, COL.round),
    status: choiceOr(source, COL.status, SUBMISSION_ROUND_STATUSES, 'pending'),
    enteredAt: optionalText(source, COL.enteredAt) ?? '',
    decidedAt: optionalText(source, COL.decidedAt),
  }
}

export function mapReview(record: AirtableRecord): Review {
  const source = view(TABLES.reviews, record)
  return {
    id: source.id,
    submissionId: requiredLink(source, COL.submission),
    roundId: requiredLink(source, COL.round),
    reviewerId: requiredLink(source, COL.reviewer),
    scores: jsonBlob(source, COL.scoresJson, scoresSchema, {}),
    notes: jsonBlob(source, COL.notesJson, criterionNotesSchema, {}),
    recused: checkbox(source, COL.recused),
    comment: optionalText(source, COL.comment),
    // Optional on purpose: a reviewer can save scores before deciding, and
    // scoring.ts counts an absent recommendation as an abstention.
    recommendation: optionalChoice(source, COL.recommendation, REVIEW_RECOMMENDATIONS),
    updatedAt: optionalText(source, COL.updatedAt) ?? '',
  }
}
