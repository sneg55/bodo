// The AI pre-screen job row, and the two identities it depends on.
//
// A separate vocabulary from `@/constants/status` on purpose. Those are lifecycles an
// organizer sees and reasons about; this one describes a queue that nobody edits by hand,
// and the migration, the mapper and the drain all have to agree on it exactly. Keeping it
// next to the job type means the four spellings cannot drift apart in a rename.

import type { RecordId } from '@/types/domain'

/**
 * A job is `queued` until a tick claims it, `running` while a model call is in flight,
 * and then `done` or `failed`. There is no `cancelled`: an organizer who changes their
 * mind lets the queue finish, because a half-scored round is harder to explain than a
 * fully scored one, and nothing here writes anything an admin cannot ignore.
 */
export const AI_PRESCREEN_STATUSES = ['queued', 'running', 'done', 'failed'] as const
export type AiPrescreenStatus = (typeof AI_PRESCREEN_STATUSES)[number]

export type AiPrescreenJob = {
  readonly id: RecordId
  readonly eventId: RecordId
  readonly roundId: RecordId
  readonly submissionId: RecordId
  readonly status: AiPrescreenStatus
  /**
   * Incremented BEFORE the model call, not after it. A Workers request cancelled
   * mid-call never reaches an "after", so an attempt counted on the way out is an
   * attempt a job that always dies would never accumulate, and the cap would not hold.
   */
  readonly attempts: number
  /**
   * Whether the review this job wrote came from the keyless sample rather than the model.
   *
   * Written when a run FINISHES, so it is false on a row that has not been scored yet and
   * false on a row that failed. It exists because a sample writes an ordinary AI review and
   * an ordinary done job: without it, adding `ANTHROPIC_API_KEY` to a base that was
   * demonstrated under the default `AI_MOCK=1` could never re-score anything, since neither
   * the enqueue skip nor the review itself can tell a sample from a real verdict.
   */
  readonly mocked: boolean
  /** The last failure, as `AppError.toLogLine()` renders it. */
  readonly error?: string
  readonly queuedAt: string
  readonly startedAt?: string
  readonly finishedAt?: string
}

/**
 * The AdminUsers row every AI review is written under.
 *
 * `Reviews.reviewer` links to AdminUsers (`src/migrations/tables-review.ts`), so this is
 * an ordinary row rather than a special case in the schema: the pre-screen writes through
 * the same `saveReview` a human reviewer does, and everything downstream that groups by
 * reviewer keeps working. It deliberately holds NO `EventMemberships` row, because it is
 * an author of reviews and never a caller: a membership would make it a principal that
 * `requireEventRole` could satisfy, and nothing should ever be able to act as it.
 */
export const AI_REVIEWER_EMAIL = 'ai@system'
export const AI_REVIEWER_NAME = 'AI Pre-screen'
