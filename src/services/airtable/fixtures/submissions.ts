// Fixture form and submission graph. Split from event.ts only to stay under the
// 300-line file limit; see that file for what these fixtures are for.
//
// Two deliberate landmines, because a demo of conflict detection needs conflicts:
// fixSub1 and fixSub2 overlap in the same room, and fixSpk3 co-presents on both,
// so the same run exercises room overlap and participant overlap across rooms.

import type { Review, ReviewAssignment, Submission, SubmissionParticipant } from '@/types/domain'

/** Shared defaults. Spread first, then override, so each row shows only what differs. */
const BASE = {
  eventId: 'fixEvent1',
  formId: 'fixForm1' as string | undefined,
  source: 'form' as Submission['source'],
  reviewRequired: true,
  tagIds: [] as readonly string[],
  calendarSequence: 0,
  calendarStatus: 'active' as Submission['calendarStatus'],
  scheduleStatus: 'unscheduled' as Submission['scheduleStatus'],
  contentStatus: 'not_submitted' as Submission['contentStatus'],
}

export const FIXTURE_SUBMISSIONS: readonly Submission[] = [
  {
    ...BASE,
    id: 'fixSub1',
    submitterId: 'fixSpk1',
    code: 'SESS-1',
    title: 'Evaluating agents without a golden dataset',
    status: 'accepted',
    answers: { fld_desc: '<p>How to build evals when you have no labels.</p>' },
    format: 'talk',
    trackId: 'fixTrack2',
    submittedAt: '2026-08-03T10:00:00.000Z',
    notifiedAt: '2026-08-06T12:00:00.000Z',
    // Deliberate room double-booking with fixSub2, so the Conflicts tab has content.
    roomId: 'fixRoom1',
    startsAt: '2026-10-12T17:00:00.000Z',
    endsAt: '2026-10-12T17:30:00.000Z',
    scheduleStatus: 'scheduled',
  },
  {
    ...BASE,
    id: 'fixSub2',
    submitterId: 'fixSpk2',
    code: 'SESS-2',
    title: 'Retrieval that survives production traffic',
    status: 'accepted',
    answers: { fld_desc: '<p>Sharding, caching, and the failure modes.</p>' },
    format: 'talk',
    trackId: 'fixTrack3',
    submittedAt: '2026-08-03T14:00:00.000Z',
    notifiedAt: '2026-08-06T12:00:00.000Z',
    roomId: 'fixRoom1',
    startsAt: '2026-10-12T17:15:00.000Z',
    endsAt: '2026-10-12T17:45:00.000Z',
    scheduleStatus: 'scheduled',
  },
  {
    ...BASE,
    id: 'fixSub3',
    submitterId: 'fixSpk3',
    code: 'SESS-3',
    title: 'Why agent plans fail halfway',
    status: 'pending',
    answers: { fld_desc: '<p>A taxonomy of mid-trajectory failures.</p>' },
    format: 'talk',
    trackId: 'fixTrack1',
    submittedAt: '2026-08-05T09:30:00.000Z',
  },
  {
    ...BASE,
    id: 'fixSub4',
    submitterId: 'fixSpk1',
    code: 'SESS-4',
    title: 'Hands-on: building an eval harness',
    status: 'accept_queue',
    answers: {
      fld_desc: '<p>Ninety minutes, bring a laptop.</p>',
      fld_lab: 'Python 3.12 and Docker installed',
    },
    format: 'workshop',
    trackId: 'fixTrack3',
    submittedAt: '2026-08-05T11:00:00.000Z',
  },
  {
    ...BASE,
    id: 'fixSub5',
    submitterId: 'fixSpk2',
    code: 'SESS-5',
    title: 'Draft: streaming tool calls',
    status: 'draft',
    answers: {},
    format: 'talk',
  },
  {
    // A session-form submission: guaranteed speaker, born accepted, never reviewed.
    // See BUILD_SPEC §5.1b. formId is absent because this one was entered manually.
    ...BASE,
    id: 'fixSub6',
    formId: undefined,
    source: 'manual',
    reviewRequired: false,
    submitterId: 'fixSpk4',
    code: 'SESS-6',
    title: 'Sponsor keynote: the developer platform in 2027',
    status: 'accepted',
    answers: {},
    format: 'talk',
    trackId: 'fixTrack4',
    tagIds: ['fixTag3'],
    submittedAt: '2026-08-04T08:00:00.000Z',
  },
]

export const FIXTURE_PARTICIPANTS: readonly SubmissionParticipant[] = [
  {
    id: 'fixPar1',
    submissionId: 'fixSub1',
    speakerId: 'fixSpk1',
    role: 'speaker',
    isPrimary: true,
    sortOrder: 1,
  },
  // fixSpk3 co-presents on both fixSub2 and fixSub1's overlapping slot, which is
  // the participant-overlap case the conflict detector has to catch across rooms.
  {
    id: 'fixPar2',
    submissionId: 'fixSub1',
    speakerId: 'fixSpk3',
    role: 'co_speaker',
    isPrimary: false,
    sortOrder: 2,
  },
  {
    id: 'fixPar3',
    submissionId: 'fixSub2',
    speakerId: 'fixSpk2',
    role: 'speaker',
    isPrimary: true,
    sortOrder: 1,
  },
  {
    id: 'fixPar4',
    submissionId: 'fixSub2',
    speakerId: 'fixSpk3',
    role: 'co_speaker',
    isPrimary: false,
    sortOrder: 2,
  },
  {
    id: 'fixPar5',
    submissionId: 'fixSub3',
    speakerId: 'fixSpk3',
    role: 'speaker',
    isPrimary: true,
    sortOrder: 1,
  },
  {
    id: 'fixPar6',
    submissionId: 'fixSub4',
    speakerId: 'fixSpk1',
    role: 'speaker',
    isPrimary: true,
    sortOrder: 1,
  },
  {
    id: 'fixPar7',
    submissionId: 'fixSub5',
    speakerId: 'fixSpk2',
    role: 'speaker',
    isPrimary: true,
    sortOrder: 1,
  },
  {
    id: 'fixPar8',
    submissionId: 'fixSub6',
    speakerId: 'fixSpk4',
    role: 'speaker',
    isPrimary: true,
    sortOrder: 1,
  },
]

export const FIXTURE_ASSIGNMENTS: readonly ReviewAssignment[] = [
  {
    id: 'fixAsg1',
    submissionId: 'fixSub3',
    roundId: 'fixRound1',
    reviewerId: 'fixUser2',
    viaTeamId: 'fixTeam1',
    assignedAt: '2026-08-05T10:00:00.000Z',
    source: 'team',
  },
  {
    id: 'fixAsg2',
    submissionId: 'fixSub3',
    roundId: 'fixRound1',
    reviewerId: 'fixUser3',
    viaTeamId: 'fixTeam1',
    assignedAt: '2026-08-05T10:00:00.000Z',
    source: 'team',
  },
  {
    id: 'fixAsg3',
    submissionId: 'fixSub4',
    roundId: 'fixRound1',
    reviewerId: 'fixUser2',
    viaTeamId: 'fixTeam1',
    assignedAt: '2026-08-05T12:00:00.000Z',
    source: 'team',
  },
]

export const FIXTURE_REVIEWS: readonly Review[] = [
  {
    id: 'fixRev1',
    submissionId: 'fixSub3',
    roundId: 'fixRound1',
    reviewerId: 'fixUser2',
    scores: { relevance: 5, clarity: 4 },
    notes: {},
    recused: false,
    comment: 'Strong topic, would attend.',
    recommendation: 'yes',
    updatedAt: '2026-08-06T09:00:00.000Z',
  },
  {
    id: 'fixRev2',
    submissionId: 'fixSub3',
    roundId: 'fixRound1',
    reviewerId: 'fixUser3',
    scores: { relevance: 3, clarity: 5 },
    notes: {},
    recused: false,
    recommendation: 'maybe',
    updatedAt: '2026-08-06T10:00:00.000Z',
  },
]
