// Local fixture data, used when no Airtable credentials are configured.
//
// Two jobs. It lets the whole UI be built and reviewed before a base exists, and
// it is the shape the seed script writes into a real base, so a demo and a
// fixtures run look the same. `hasAirtable()` in src/utils/env.ts decides which
// the DAL serves; nothing else in the codebase knows there are two sources.
//
// Deliberately small but not degenerate: it contains a room double-booking and a
// shared co-speaker across two slots, because a conflict detector with nothing to
// detect proves nothing on a demo. Ids use readable prefixes rather than real
// `rec...` values so a fixture leaking into a screenshot is obvious.

import { DEFAULT_PARTICIPANT_ROLES } from '@/constants/status'
import type {
  AdminUser,
  EvaluationPlan,
  Event,
  EventMembership,
  Review,
  ReviewAssignment,
  ReviewTeam,
  Room,
  Round,
  Speaker,
  Submission,
  SubmissionParticipant,
  Tag,
  Track,
} from '@/types/domain'
import type { Form } from '@/types/forms'
import { AI_REVIEWER_EMAIL, AI_REVIEWER_NAME } from '@/types/prescreen'

export const FIXTURE_EVENT: Event = {
  id: 'fixEvent1',
  name: 'AI Engineer Sandbox',
  slug: 'ai-engineer-sandbox',
  eventType: 'Conference',
  websiteUrl: 'https://ai.engineer',
  location: 'San Francisco, CA',
  startsAt: '2026-10-12T09:00:00.000Z',
  endsAt: '2026-10-14T18:00:00.000Z',
  timezone: 'America/Los_Angeles',
  theme: 'Agents that ship.',
  cfpDeadline: '2026-09-15T23:59:00.000Z',
  submissionLimitPerUser: 3,
  status: 'open',
  accelSyncEnabled: false,
}

export const FIXTURE_ROOMS: readonly Room[] = [
  { id: 'fixRoom1', eventId: 'fixEvent1', name: 'Main Stage', capacity: 800, order: 1 },
  { id: 'fixRoom2', eventId: 'fixEvent1', name: 'Workshop A', capacity: 120, order: 2 },
  { id: 'fixRoom3', eventId: 'fixEvent1', name: 'Workshop B', capacity: 120, order: 3 },
]

export const FIXTURE_TRACKS: readonly Track[] = [
  { id: 'fixTrack1', eventId: 'fixEvent1', name: 'Agents', color: '#2563eb', order: 1 },
  { id: 'fixTrack2', eventId: 'fixEvent1', name: 'Evals', color: '#7c3aed', order: 2 },
  { id: 'fixTrack3', eventId: 'fixEvent1', name: 'Infra', color: '#059669', order: 3 },
  { id: 'fixTrack4', eventId: 'fixEvent1', name: 'Product', color: '#d97706', order: 4 },
]

export const FIXTURE_TAGS: readonly Tag[] = [
  { id: 'fixTag1', eventId: 'fixEvent1', name: 'Beginner Friendly', color: '#64748b' },
  { id: 'fixTag2', eventId: 'fixEvent1', name: 'Live Demo', color: '#0ea5e9' },
  { id: 'fixTag3', eventId: 'fixEvent1', name: 'Sponsor', color: '#f43f5e' },
]

export const FIXTURE_SPEAKERS: readonly Speaker[] = [
  {
    id: 'fixSpk1',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Okafor',
    pronouns: 'she/her',
    bio: 'Builds evaluation harnesses for production agents.',
    tagline: 'Staff Engineer',
    company: 'Northwind AI',
    links: { linkedin: 'https://linkedin.com/in/example' },
  },
  {
    id: 'fixSpk2',
    email: 'bruno@example.com',
    firstName: 'Bruno',
    lastName: 'Salgado',
    bio: 'Works on retrieval infrastructure.',
    company: 'Vector Foundry',
    links: {},
  },
  {
    id: 'fixSpk3',
    email: 'chen@example.com',
    firstName: 'Chen',
    lastName: 'Wei',
    pronouns: 'they/them',
    bio: 'Researches agent planning failures.',
    company: 'Institute for Applied Reasoning',
    links: { website: 'https://example.com' },
  },
  {
    id: 'fixSpk4',
    email: 'dara@example.com',
    firstName: 'Dara',
    lastName: 'Nasser',
    bio: 'Sponsor keynote, developer platform lead.',
    company: 'Cloudspan',
    links: {},
  },
]

export const FIXTURE_ADMINS: readonly AdminUser[] = [
  { id: 'fixUser1', email: 'organizer@example.com', name: 'Sam Organizer' },
  { id: 'fixUser2', email: 'reviewer1@example.com', name: 'Rae Reviewer' },
  { id: 'fixUser3', email: 'reviewer2@example.com', name: 'Kim Critic' },
  // The AI pre-screen's identity, matching the seed. It gets no FIXTURE_MEMBERSHIPS row
  // for the reason `@/types/prescreen` gives: it authors reviews and is never a caller,
  // and a membership would make it something `requireEventRole` could satisfy.
  { id: 'fixUserAi', email: AI_REVIEWER_EMAIL, name: AI_REVIEWER_NAME },
]

export const FIXTURE_MEMBERSHIPS: readonly EventMembership[] = [
  {
    id: 'fixMem1',
    eventId: 'fixEvent1',
    userId: 'fixUser1',
    role: 'admin',
    addedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'fixMem2',
    eventId: 'fixEvent1',
    userId: 'fixUser2',
    role: 'reviewer',
    addedAt: '2026-08-02T00:00:00.000Z',
  },
  {
    id: 'fixMem3',
    eventId: 'fixEvent1',
    userId: 'fixUser3',
    role: 'reviewer',
    addedAt: '2026-08-02T00:00:00.000Z',
  },
]

export const FIXTURE_PLAN: EvaluationPlan = {
  id: 'fixPlan1',
  eventId: 'fixEvent1',
  name: '2026 Program Review',
  status: 'active',
}

/**
 * Two rounds that differ in every setting the plan editor can change, because the
 * no-credentials demo is the only place some of this is ever seen: Screening is open
 * and blind with two sliders, Final is named, dated, anonymised off, restricted to a
 * pool of one, and mixes a slider with a dropdown and a free-text criterion.
 */
export const FIXTURE_ROUNDS: readonly Round[] = [
  {
    id: 'fixRound1',
    planId: 'fixPlan1',
    eventId: 'fixEvent1',
    name: 'Screening',
    order: 1,
    criteria: [
      { key: 'relevance', label: 'Relevance', kind: 'numeric', min: 1, max: 5, weight: 2 },
      { key: 'clarity', label: 'Clarity', kind: 'numeric', min: 1, max: 5, weight: 1 },
    ],
    startsAt: '2026-08-01T09:00:00.000Z',
    endsAt: '2026-08-14T17:00:00.000Z',
    anonymous: true,
    reviewerIds: [],
  },
  {
    id: 'fixRound2',
    planId: 'fixPlan1',
    eventId: 'fixEvent1',
    name: 'Final',
    order: 2,
    criteria: [
      { key: 'depth', label: 'Technical Depth', kind: 'numeric', min: 1, max: 5, weight: 3 },
      {
        key: 'delivery',
        label: 'Speaker Delivery',
        kind: 'select',
        min: 1,
        max: 3,
        weight: 1,
        options: [
          { label: 'Needs coaching', value: 1 },
          { label: 'Solid', value: 2 },
          { label: 'Excellent', value: 3 },
        ],
      },
      // Weight 0 because a text criterion is never scored. See `Criterion.kind`.
      {
        key: 'notes',
        label: 'Anything the chair should know',
        kind: 'text',
        min: 0,
        max: 0,
        weight: 0,
      },
    ],
    startsAt: '2026-08-15T09:00:00.000Z',
    anonymous: false,
    reviewerIds: ['fixUser2'],
  },
]

export const FIXTURE_TEAM: ReviewTeam = {
  id: 'fixTeam1',
  eventId: 'fixEvent1',
  name: 'Program Committee',
  description: 'Screens every abstract in round one.',
}
