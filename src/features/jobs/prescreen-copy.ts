// What the pre-screen panel says: why the button is disabled, and what one press of it did.
//
// Pure functions rather than branches inside the client component, for the reason
// `prescreen-queue.ts` gives for its own split: these are the answers an organizer will
// argue with ("it says it queued nothing"), and there is no component test harness in this
// repo, so a sentence chosen inside `PrescreenPanel` is a sentence nothing can assert.
//
// Separate from prescreen-queue.ts because that file is the queue's arithmetic and this is
// its copy, and keeping them together pushed it past the file limit.

import {
  PRESCREEN_MAX_ATTEMPTS,
  type PrescreenCounts,
  prescreenOutstanding,
} from '@/features/jobs/prescreen-queue'
import type { RecordId } from '@/types/domain'

/**
 * The sentence over the progress bar.
 *
 * The bar measures whether the QUEUE has drained, so a job that stopped at the attempt cap
 * counts toward it: nothing will move it again and a bar that waits for it never fills.
 * The finished sentence counts what was SCORED, which is a different number as soon as one
 * job stopped, and the difference is the whole point. "Pre-screened 32 of 32" over a round
 * where one submission was never sent to the model is a claim about a review that does not
 * exist, and the badge underneath saying one job stopped does not take it back.
 */
export function prescreenProgressLabel(counts: PrescreenCounts): string {
  const settled = counts.done + counts.blocked
  if (settled < counts.total) return `Pre-screening ${settled} of ${counts.total}`
  return `Pre-screened ${counts.done} of ${counts.total}`
}

/**
 * What the panel says about the jobs that stopped, or nothing when none did.
 *
 * It exists because a round could end up permanently unscored with nothing on screen to
 * argue with. Every job for the round failed three times (the rubric schema the model API
 * rejected outright), the badge said `2 stopped after 3 attempts`, and the next press
 * answered `Nothing to pre-screen, this round is already covered`: no reason, and no way
 * back. `prescreenTargets` now retries a stopped row, so this is the other half, the
 * sentence that says the press is the retry.
 *
 * It does NOT say "some failed" and stop there. The reasons come from
 * `prescreenFailures(jobs)` and are rendered under this line, because the one thing an
 * organizer can act on is what the model or the base actually said.
 */
export function prescreenStoppedNotice(counts: PrescreenCounts): string | undefined {
  if (counts.blocked === 0) return undefined
  const one = counts.blocked === 1
  return `${counts.blocked} submission${one ? '' : 's'} stopped after ${PRESCREEN_MAX_ATTEMPTS} attempts and ${one ? 'was' : 'were'} never scored. Press AI pre-screen to try ${one ? 'it' : 'them'} again.`
}

/**
 * Why the round cannot be pre-screened, or nothing when it can.
 *
 * Order matters. With no base the DAL serves read-only fixtures (`data-source.ts`), and
 * `getAiReviewerId()` answers with the FIXTURE `ai@system` row, so the seeded-reviewer check
 * below passes and the button enabled itself over a write that throws `CFG_ENV_MISSING` on
 * the first call. The base is therefore asked about first.
 *
 * Sentences rather than a boolean, because the panel renders exactly one of them and a
 * disabled control that does not say why is the same bug wearing a different hat.
 */
export function prescreenUnavailableReason(input: {
  hasBase: boolean
  reviewerId?: RecordId
  /** True when the queue read failed. See features/jobs/prescreen-progress.ts. */
  queueUnreadable?: boolean
}): string | undefined {
  if (!input.hasBase) {
    return 'No Airtable base is configured on this deployment, so there is nowhere to queue jobs. This event is fixture data, which is read-only.'
  }
  if (input.reviewerId === undefined) {
    return 'The ai@system reviewer has not been seeded on this base, so pre-screening is unavailable. Run the seed script to create it.'
  }
  // Last of the three, because the two above are settled configuration and this one is a
  // read that failed a moment ago and may well work on the next render. Saying "not seeded"
  // when the base simply could not be reached would send an organizer to fix the wrong thing.
  //
  // It disables the button as the others do, and that is the point rather than a side
  // effect: pressing it decides create-or-skip per submission, and offering that decision on
  // top of a list nobody could read is how a round gets a second job for every submission.
  if (input.queueUnreadable === true) {
    return 'The pre-screen queue could not be read just now, so its progress is not shown. Nothing has been lost; reload in a moment.'
  }
  return undefined
}

/** What the Server Action hands back, reduced to what the panel reports. */
export type PrescreenPressResult =
  | { readonly ok: false; readonly message: string }
  | {
      readonly ok: true
      readonly queued: number
      readonly skipped: number
      readonly contended: boolean
    }

export type PrescreenPressOutcome = {
  /** Which `sonner` toast the panel calls. */
  readonly tone: 'error' | 'info' | 'success'
  readonly message: string
  /**
   * Whether the browser has to go back to the server for a new render.
   *
   * True on exactly one branch, and it is the branch that wrote nothing. Every other
   * outcome went through `invalidate()`, which expires the tags the write touched and
   * re-renders this route as part of the action's own response, so a refresh on top would
   * be the wasted round trip BUILD_SPEC 6.1 warns about.
   *
   * A press that LOST the round is the exception, because it invalidated nothing and so
   * nothing re-renders. On an empty round the loser returns before the winner has created
   * a single row, which leaves the panel holding `total: 0`: the progress line is not
   * rendered at all, the poller is not mounted because there is nothing outstanding, and
   * that browser never makes another request. `router.refresh()` is the one that picks up
   * the winner's rows.
   */
  readonly refresh: boolean
}

/**
 * What one press of `AI pre-screen` reports, and whether it has to ask the server again.
 *
 * Contention is an ordinary outcome rather than an error: the other press is queueing this
 * round, so this one has nothing to do and nothing went wrong.
 */
export function prescreenPressOutcome(input: {
  readonly roundName: string
  readonly result: PrescreenPressResult
}): PrescreenPressOutcome {
  const { result, roundName } = input
  if (!result.ok) return { tone: 'error', message: result.message, refresh: false }

  if (result.contended) {
    return {
      tone: 'info',
      message: `${roundName} is already being queued. That run covers this one.`,
      refresh: true,
    }
  }
  if (result.queued === 0) {
    return {
      tone: 'success',
      // Not "already covered", which is a claim about SCORES that this number does not
      // support: a round whose jobs are all still queued queues nothing on a second press
      // too, and so did the round whose jobs had all stopped, which is how one came to
      // report itself covered with nothing scored at all.
      message: `Nothing new to queue. Every submission in ${roundName} is already scored or waiting in the queue.`,
      refresh: false,
    }
  }
  return {
    tone: 'success',
    message: `${result.queued} queued for pre-screening, ${result.skipped} already done. Scoring runs in the background.`,
    refresh: false,
  }
}

/**
 * How many server payloads the panel waits through for the winner's rows to show up.
 *
 * Six, against the poller's 10s interval, so about a minute of waiting. The winner creates
 * the round's rows inside its own action, a few seconds of Airtable writes, so a minute is
 * already generous; the number exists to bound the wait, not to time it.
 */
export const PRESCREEN_WAIT_ATTEMPTS = 6

export type PrescreenWaitState = {
  /**
   * Whether `ProgressPoller` stays mounted.
   *
   * The same poller the tasks dashboard uses, and the only polling on this surface: while
   * the round has rows this is "is anything outstanding", and while it has none it is "is
   * the panel still waiting for the press that beat it".
   */
  readonly polling: boolean
  /** The line under the button, or nothing when there is nothing to explain. */
  readonly notice?: string
}

/**
 * Whether an empty-looking panel is still waiting for another press, and what it says.
 *
 * The case is contention on a round with no job rows yet. The press that LOSES returns as
 * soon as the claim is refused, which is while the winner is still doing its reads, so the
 * render it asks for lands on `total: 0`: no progress line, nothing outstanding, no poller,
 * and that browser never asks the server anything again. One refresh cannot fix that,
 * because the thing it is waiting for had not happened yet when it ran.
 *
 * So the loser holds a waiting flag and keeps the poller mounted until rows appear. Three
 * outcomes, and the last one is the point:
 *
 *   - **Rows exist.** The wait is over whatever the flag says, and polling goes back to
 *     being `prescreenOutstanding`, which stops on its own when the queue drains.
 *   - **No rows, attempts left.** Keep polling, and say so, because an empty panel with no
 *     progress bar otherwise looks like a press that did nothing.
 *   - **No rows, attempts spent.** Stop. This is the winner having crashed before it
 *     created a single row: its claim was taken, its writes never happened, and no tick
 *     will produce rows for a round nothing was queued for. Polling for that is polling
 *     forever, so the panel stops and says the round was not queued and can be pressed
 *     again, which is true and actionable, rather than spinning on a queue that does not
 *     exist. (The claim is leased, not permanent, so the retry is not blocked by it.)
 */
export function prescreenWaitState(input: {
  readonly counts: PrescreenCounts
  readonly waiting: boolean
  readonly attempts: number
}): PrescreenWaitState {
  const { attempts, counts, waiting } = input
  if (counts.total > 0) return { polling: prescreenOutstanding(counts) }
  if (!waiting) return { polling: false }
  if (attempts < PRESCREEN_WAIT_ATTEMPTS) {
    return {
      polling: true,
      notice: 'Waiting for the other run to finish queueing this round.',
    }
  }
  return {
    polling: false,
    notice:
      'The other run has not queued anything for this round. It may have stopped before it created any jobs. Press AI pre-screen to queue it yourself.',
  }
}
