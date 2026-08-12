// The shapes the Evaluation surface renders.
//
// Split out of evaluation-view.ts, which assembles them and had grown past the size the
// repo allows. Types only: nothing here reads Airtable or decides anything, so a component
// that wants the shape does not pull the loader's import graph along with it.

import type { EventRole, SubmissionStatus } from '@/constants/status'
import type { PrescreenCounts, PrescreenFailure } from '@/features/jobs/prescreen-queue'
import type { ReviewDraftState } from '@/features/review/review-draft'
import type { EventReviewer, ReviewTeamWithMembers } from '@/features/review/review-reads'
import type { ReviewerProgressRow } from '@/features/review/reviewer-progress'
import type { Criterion, EvaluationPlan, RecordId } from '@/types/domain'

export type QueueItem = {
  readonly submissionId: RecordId
  readonly code: string
  readonly title: string
  /**
   * The abstract itself, as plain text and NOT truncated.
   *
   * A reviewer was being asked to score a talk from its title. The anonymisation control
   * says in as many words that a reviewer "sees the title and the abstract", and only the
   * first half of that was true. Untruncated because the 240-character cap the Abstracts
   * table applies exists so a cell does not ship a 5,000-character body per row, and this
   * is one submission at a time and the thing being judged.
   *
   * Plain text rather than the stored HTML: it came out of a rich-text editor a speaker
   * typed into, and no surface here renders caller-supplied HTML.
   */
  readonly description: string
  readonly status: SubmissionStatus
  readonly trackName?: string
  readonly draft: ReviewDraftState
  /** True when this reviewer has already saved something for this round. */
  readonly reviewed: boolean
  /**
   * Who submitted it, already resolved to names, and ABSENT on an anonymised round.
   *
   * Withheld here rather than hidden in the component, which is the difference between
   * anonymisation and a CSS class over it: on an anonymised round the names never leave
   * the server, so they are not in the payload a reviewer can open the network tab on.
   */
  readonly authors?: string
}

export type RoundSummary = {
  readonly id: RecordId
  readonly name: string
  readonly order: number
  readonly criteria: readonly Criterion[]
  /** Assignments in this round, across the whole committee. */
  readonly assigned: number
  /** Of those, how many have a review saved. This is the progress bar. */
  readonly reviewed: number
  readonly anonymous: boolean
  /** The round's reviewer pool. Empty means everyone on the event. */
  readonly reviewerIds: readonly RecordId[]
  readonly startsAt?: string
  readonly endsAt?: string
}

export type AssignableSubmission = {
  readonly id: RecordId
  readonly code: string
  readonly title: string
  readonly trackName?: string
  readonly trackId?: RecordId
}

/** What the round's AI pre-screen control renders. Only assembled for an admin. */
export type PrescreenView = {
  /** Jobs for the ACTIVE round only, so the line matches the tab somebody is looking at. */
  readonly counts: PrescreenCounts
  /**
   * Why this round's stopped jobs stopped, grouped, most common first. Empty when none did.
   *
   * The panel used to render `2 stopped after 3 attempts` and nothing else, so a round that
   * failed on every single submission for one fixable reason (the structured-output schema
   * the model API rejects with a 400) looked identical to one that had hit a rate limit.
   * The drain already writes the reason onto the row; this is what carries it to the screen.
   */
  readonly failures: readonly PrescreenFailure[]
  /**
   * The sample disclosure when no `ANTHROPIC_API_KEY` is configured, and nothing when the
   * calls are live. A canned answer that looks live is worse than no answer at all
   * (`src/services/ai/mock.ts`), so the panel renders whatever is here.
   *
   * The STRING travels rather than a boolean, because the panel is a client component and
   * `@/services/ai` reaches `@anthropic-ai/sdk` through `client.ts`: importing
   * `AI_SAMPLE_NOTICE` there would ship the SDK to the browser to render one sentence.
   */
  readonly sampleNotice?: string
  /** Absent when the `ai@system` row has not been seeded, which disables the button. */
  readonly reviewerId?: RecordId
  /**
   * Whether this deployment has an Airtable base at all.
   *
   * The other half of what disables the button, and it has to be asked separately: with no
   * base the DAL serves read-only fixtures, so `reviewerId` is answered by the FIXTURE
   * `ai@system` row and looks perfectly healthy right up to the enqueue write, which throws
   * `CFG_ENV_MISSING` from `getClient()`. Fixtures are read-only by design
   * (`src/services/airtable/data-source.ts`), so the honest answer is a disabled control
   * that says so, not a queue that pretends.
   */
  readonly hasBase: boolean
  /**
   * True when the queue could not be READ, which is not the same as a round with no jobs.
   *
   * `counts` is all zeros in both cases, and the panel draws no progress bar for either, so
   * without this flag a round with 32 scored submissions would render exactly like one that
   * has never run. It says so instead, and disables the button, because a create-or-skip
   * decision offered on top of a list nobody could read is not a decision.
   *
   * See features/jobs/prescreen-progress.ts for why this read is tolerated at all when the
   * `ai@system` lookup two lines above it in the same `Promise.all` is not.
   */
  readonly queueUnreadable: boolean
}

export type EvaluationView = {
  readonly plan?: EvaluationPlan
  readonly rounds: readonly RoundSummary[]
  readonly activeRoundId?: RecordId
  readonly queue: readonly QueueItem[]
  readonly role: EventRole
  /**
   * Per-reviewer completion for the active round. Admin only.
   *
   * Beside `rounds[].reviewed`, not instead of it. The round total says how far the
   * committee is; this says who is behind, which is the question that has an action
   * attached to it.
   */
  readonly progress: readonly ReviewerProgressRow[]
  /**
   * Committees WITH their membership, and the people on the event. Admin only.
   *
   * The membership travels because the assignment panel has to know, before the press,
   * whether the committee somebody picked has anybody in this round's pool: without it the
   * only feedback was an error toast after the round trip, which read as a control that
   * silently did nothing.
   */
  readonly teams: readonly ReviewTeamWithMembers[]
  readonly reviewers: readonly EventReviewer[]
  readonly assignable: readonly AssignableSubmission[]
  readonly prescreen?: PrescreenView
  /** Whether AI reviews were counted in the per-round progress. False by default. */
  readonly includeAi: boolean
}
