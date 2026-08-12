// The twelve submissions, as data. Written by steps-content.ts.
//
// Split from the writing code so the scenario can be read as a scenario: every
// lifecycle state appears once, the four tracks are all used, and the two rows that
// deliberately collide are the ones named in scenario.ts rather than a pair of
// timestamps buried in a list.
//
// Two rows here are the reason the seed exists at all rather than being decoration:
// the CONFLICT pair double-books Main Stage, and the first of them carries three
// participants with Chen also co-presenting on the second, so the agenda's room rule
// and its participant rule both have something to find on a fresh base.

import type { ContentStatus, ParticipantRole, SubmissionStatus } from '@/constants/status'
import { CONFLICT, SPEAKERS, TAGS, TRACKS } from './scenario'

export type Placement = { room: string; startsAt: string; endsAt: string }

export type SubmissionSeed = {
  title: string
  /** Speaker email. The account that owns the draft, not the cast. */
  submitter: string
  status: SubmissionStatus
  /**
   * Where the session's CONTENT stands, which is the second gate on the public agenda: a
   * published session in `pending_review` or `changes_requested` is withheld from
   * `/agenda/<slug>` and from every embed until it is approved (`publicSessionRows`).
   *
   * Omitted means `not_submitted`, which is the column's own floor and is NOT withheld, so
   * most of the twelve can carry nothing and still reach the page. That is deliberate on
   * both sides: the gate is written so a base that has never touched this column publishes
   * normally, and the seed is written so it does not paper over that by approving everything.
   *
   * What the four accepted rows demonstrate: three approved, one sent back. The sent-back one
   * is the only session `Publish Agenda` will not put in front of a visitor, which is the
   * behaviour worth being able to see on a fresh base.
   */
  contentStatus?: ContentStatus
  /** Track name, resolved to a record id at write time. */
  track: string
  format: 'talk' | 'workshop'
  tags?: readonly string[]
  /** `source=manual`, no form link, and review skipped. Section 5.1b. */
  manual?: boolean
  submittedAt?: string
  notifiedAt?: string
  placement?: Placement
  answers?: Readonly<Record<string, unknown>>
  /** First entry is the primary participant, exactly one per submission. */
  participants: readonly (readonly [string, ParticipantRole])[]
}

const NOTIFIED = '2026-08-06T12:00:00.000Z'

export const SUBMISSIONS: readonly SubmissionSeed[] = [
  {
    title: CONFLICT.a.title,
    submitter: SPEAKERS.ada,
    status: 'accepted',
    contentStatus: 'approved',
    track: TRACKS.evals,
    format: 'talk',
    submittedAt: '2026-08-03T10:00:00.000Z',
    notifiedAt: NOTIFIED,
    placement: { room: CONFLICT.room, startsAt: CONFLICT.a.startsAt, endsAt: CONFLICT.a.endsAt },
    answers: { fld_desc: '<p>How to build evals when you have no labels.</p>' },
    // The multi-participant row. Chen is also on the next one, and both are placed,
    // which is what makes the participant rule fire as well as the room rule.
    participants: [
      [SPEAKERS.ada, 'speaker'],
      [CONFLICT.sharedCoSpeaker, 'co_speaker'],
      [SPEAKERS.gita, 'moderator'],
    ],
  },
  {
    title: CONFLICT.b.title,
    submitter: SPEAKERS.bruno,
    status: 'accepted',
    contentStatus: 'approved',
    track: TRACKS.infra,
    format: 'talk',
    submittedAt: '2026-08-03T14:00:00.000Z',
    notifiedAt: NOTIFIED,
    placement: { room: CONFLICT.room, startsAt: CONFLICT.b.startsAt, endsAt: CONFLICT.b.endsAt },
    answers: { fld_desc: '<p>Sharding, caching, and the failure modes.</p>' },
    participants: [
      [SPEAKERS.bruno, 'speaker'],
      [CONFLICT.sharedCoSpeaker, 'co_speaker'],
    ],
  },
  {
    // Accepted and never reviewed: entered by hand, so it has no form and no round.
    title: 'Sponsor keynote: the developer platform in 2027',
    submitter: SPEAKERS.dara,
    status: 'accepted',
    contentStatus: 'approved',
    track: TRACKS.product,
    format: 'talk',
    tags: [TAGS.sponsor],
    manual: true,
    submittedAt: '2026-08-04T08:00:00.000Z',
    notifiedAt: NOTIFIED,
    participants: [[SPEAKERS.dara, 'speaker']],
  },
  {
    // Accepted, unplaced. Two of the four accepted rows stay in the unscheduled tray,
    // which is what the agenda builder is for.
    title: 'Hands-on: building an eval harness',
    submitter: SPEAKERS.ada,
    status: 'accepted',
    // Sent back, so the agenda has one row that is published and still not public. This is
    // the row the toolbar's "N awaiting content approval" badge counts.
    contentStatus: 'changes_requested',
    track: TRACKS.infra,
    format: 'workshop',
    tags: [TAGS.beginner],
    submittedAt: '2026-08-05T11:00:00.000Z',
    notifiedAt: NOTIFIED,
    answers: {
      fld_desc: '<p>Ninety minutes, bring a laptop.</p>',
      // The conditional field, answered, because the format is workshop.
      fld_lab: 'Python 3.12 and Docker installed',
    },
    participants: [[SPEAKERS.ada, 'speaker']],
  },
  {
    title: 'Why agent plans fail halfway',
    submitter: SPEAKERS.chen,
    status: 'pending',
    track: TRACKS.agents,
    format: 'talk',
    submittedAt: '2026-08-05T09:30:00.000Z',
    answers: { fld_desc: '<p>A taxonomy of mid-trajectory failures.</p>' },
    participants: [[SPEAKERS.chen, 'speaker']],
  },
  {
    title: 'Cost-aware tool calling',
    submitter: SPEAKERS.elena,
    status: 'pending',
    track: TRACKS.product,
    format: 'talk',
    submittedAt: '2026-08-06T09:00:00.000Z',
    answers: { fld_desc: '<p>What a tool call costs, and when not to make it.</p>' },
    participants: [[SPEAKERS.elena, 'speaker']],
  },
  {
    title: 'Observability for multi-agent systems',
    submitter: SPEAKERS.farid,
    status: 'pending',
    track: TRACKS.agents,
    format: 'talk',
    submittedAt: '2026-08-06T15:20:00.000Z',
    answers: { fld_desc: '<p>Traces when there are six of them talking at once.</p>' },
    participants: [[SPEAKERS.farid, 'speaker']],
  },
  {
    title: 'Prompt regression testing at scale',
    submitter: SPEAKERS.gita,
    status: 'accept_queue',
    track: TRACKS.evals,
    format: 'talk',
    tags: [TAGS.liveDemo],
    submittedAt: '2026-08-07T08:45:00.000Z',
    answers: { fld_desc: '<p>Golden files, but for prompts.</p>' },
    participants: [[SPEAKERS.gita, 'speaker']],
  },
  {
    title: 'The case against fine-tuning',
    submitter: SPEAKERS.hugo,
    status: 'decline_queue',
    track: TRACKS.evals,
    format: 'talk',
    submittedAt: '2026-08-07T11:10:00.000Z',
    answers: { fld_desc: '<p>An argument, made in good faith.</p>' },
    participants: [[SPEAKERS.hugo, 'speaker']],
  },
  {
    // No submittedAt: a draft has not been filed, and the Submitted column being
    // empty is exactly what distinguishes it in the Abstracts table.
    title: 'Draft: streaming tool calls',
    submitter: SPEAKERS.bruno,
    status: 'draft',
    track: TRACKS.agents,
    format: 'talk',
    participants: [[SPEAKERS.bruno, 'speaker']],
  },
  {
    title: 'Vector index maintenance nobody asked for',
    submitter: SPEAKERS.hugo,
    status: 'declined',
    track: TRACKS.infra,
    format: 'talk',
    submittedAt: '2026-08-04T16:00:00.000Z',
    notifiedAt: NOTIFIED,
    answers: { fld_desc: '<p>Compaction, and why it woke me up.</p>' },
    participants: [[SPEAKERS.hugo, 'speaker']],
  },
  {
    title: 'Agent security: the parts we skipped',
    submitter: SPEAKERS.farid,
    status: 'withdrawn',
    track: TRACKS.agents,
    format: 'talk',
    submittedAt: '2026-08-02T12:00:00.000Z',
    answers: { fld_desc: '<p>Withdrawn by the speaker, kept for the record.</p>' },
    participants: [[SPEAKERS.farid, 'speaker']],
  },
]

/** Accepted, whether placed on the grid yet or not. What tasks fan out to. */
export const ACCEPTED: readonly SubmissionSeed[] = SUBMISSIONS.filter(
  (row) => row.status === 'accepted',
)

/**
 * What the review step assigns and scores: the rows still in front of the committee.
 *
 * Derived from status rather than listed, so a thirteenth pending submission lands in
 * front of the reviewers instead of quietly staying unassigned. A decided row is
 * excluded because re-reviewing it proves nothing, and the manual sponsor keynote
 * never entered a round at all.
 */
export const AWAITING_REVIEW: readonly SubmissionSeed[] = SUBMISSIONS.filter(
  (row) => row.status === 'pending' || row.status === 'accept_queue',
)
