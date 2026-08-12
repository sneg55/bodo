// The outbox drain. One row at a time, claimed before it is sent.
//
// This is the only place in the codebase that talks to the mail provider, and the
// whole design exists because Airtable cannot help us here: there is no transaction
// and no compare-and-swap, so "read the queued rows, mark them sending, send them" is
// not safe. Two overlapping cron invocations both read the same row. Marking after
// the send loses mail when the isolate dies in between; marking before it duplicates
// mail when the provider call fails after delivering.
//
// So there are three independent protections and each covers what the others cannot:
//
//   1. `claimOnce` (a Durable Object, one id per row) decides who owns the row. Only
//      the winner sends. This is the compare-and-swap Airtable lacks.
//   2. The lease expires. A sender that crashed mid-flight releases the row instead of
//      stranding it forever, so a retry is possible at all.
//   3. The provider gets the idempotency key. That is what makes protection 2 safe:
//      a retry after a crashed-but-delivered send collapses at the provider rather
//      than arriving twice.
//
// The row's own `status`, `leaseHolder` and `leaseExpiresAt` columns are a fourth thing
// and NOT a fourth protection. They exist for two reasons. One is visibility: a row that
// nobody records as `sending` is indistinguishable from a queued one on the Comms screen,
// so an operator cannot tell an in-flight send from a stuck queue. The other is FENCING.
// Protection 2 has a cost: sender A can lose its lease while it is still building
// attachments, sender B can then claim the row, send it, and mark it `sent` at attempt 4,
// and A's later write would land on top and regress that row to `failed`. The row's
// lifecycle would then be a lie, and because `dueOutboxRows` retries `failed`, the mail
// gets another provider call it did not need. So before writing an outcome a sender
// compares the holder recorded on the row against its own and abandons the write when
// they differ.
//
// That comparison is a read and then a compare, because Airtable has no compare-and-swap.
// It is therefore BEST EFFORT: the row can change between the read and the write, so the
// window narrows, it does not close. Protection 1 is still the only lock here.
//
// Everything here takes its dependencies as arguments. Not for purity's sake: it is
// so the interleavings above can actually be tested, which is the only way to know
// the protections work.

import { AppError, ErrorIds, isAppError } from '@/constants/errorIds'
import type { EmailMessage, SendResult } from '@/services/email/send'
import type { OutboxRow } from '@/types/domain'

/** How long a sender holds a row. Longer than one provider call, shorter than a sweep. */
export const LEASE_MS = 60_000

/** Past this many attempts a row is dead and stops being retried. */
export const MAX_ATTEMPTS = 5

/**
 * The row's lease columns: the claim write, and a read of the holder it recorded.
 *
 * One dependency carrying both halves rather than two, because half of it is worse than
 * none: `heldBy` without `record` would find no holder on any row and so abandon every
 * outcome write, and `record` without `heldBy` would advertise a fence that never runs.
 */
export type OutboxLease = {
  /**
   * `claimOutboxRow`: `status: 'sending'`, this holder, and when its lease lapses. An
   * object parameter, same reason as `DrainDeps.markFailed`: a fifth positional parameter
   * (`speakerId`, passed through so the queued-to-sending transition can expire the CRM
   * comms timeline the same way `markSent` and `markFailed` do) trips the max-params lint
   * rule.
   */
  record: (input: {
    rowId: string
    holder: string
    leaseExpiresAt: string
    attempts: number
    speakerId?: string
  }) => Promise<void>
  /** The holder recorded on the row right now, or undefined when it carries none. */
  heldBy: (rowId: string) => Promise<string | undefined>
}

export type DrainDeps = {
  /** Rows with status queued and sendAt in the past. */
  listDue: () => Promise<readonly OutboxRow[]>
  /** `claimOnce` from src/utils/cf.ts. The Durable Object is what makes this atomic. */
  claim: (key: string, holder: string, ttlMs: number) => Promise<{ granted: boolean }>
  send: (message: EmailMessage) => Promise<SendResult>
  /**
   * Absent runs the drain unfenced, exactly as it behaved before: nothing records that a
   * row is in flight and every outcome write is unconditional. That is a caller that has
   * not been wired up yet rather than a supported mode.
   */
  lease?: OutboxLease
  /**
   * `speakerId` is passed through from the row so the caller can expire the CRM comms
   * timeline (`speakerCommsTag`) on a send, which `eventOutboxTag` alone does not cover:
   * the timeline reads across events. Optional because not every row addresses a speaker.
   */
  markSent: (
    rowId: string,
    providerMessageId: string,
    sentAt: string,
    speakerId?: string,
  ) => Promise<void>
  /**
   * An object parameter, unlike `markSent`, because a fifth positional parameter trips the
   * max-params lint rule. `speakerId` is passed through for the same reason `markSent`'s is.
   */
  markFailed: (input: {
    rowId: string
    attempts: number
    error: string
    dead: boolean
    speakerId?: string
  }) => Promise<void>
  /** Attachment builder, so a row that wants an invite gets one. */
  buildAttachments?: (row: OutboxRow) => Promise<EmailMessage['attachments']>
  /** The run's identity. Must be unique per invocation: see the note below. */
  holder: string
  nowMs: number
}

export type DrainResult = {
  claimed: number
  sent: number
  failed: number
  dead: number
  /** Rows another sender already held. Not an error, and not retried in this run. */
  skipped: number
  /**
   * Outcomes this run threw away because the row had moved on to a fresher holder.
   * A row counted here is left exactly as its winner left it, so it is either terminal
   * or still due, never both and never neither.
   */
  fenced: number
}

/**
 * Drain what is due.
 *
 * `holder` must be unique per invocation. `claimOnce` deliberately re-grants to the
 * same holder so a retry does not deadlock against its own earlier lease, which means
 * a holder derived from the row id would hand every concurrent sweep the same row.
 */
export async function drainOutbox(deps: DrainDeps): Promise<DrainResult> {
  const result: DrainResult = { claimed: 0, sent: 0, failed: 0, dead: 0, skipped: 0, fenced: 0 }
  const due = await deps.listDue()

  for (const row of due) {
    const claim = await deps.claim(`outbox:${row.id}`, deps.holder, LEASE_MS)
    if (!claim.granted) {
      // Another sender owns it. Leaving it alone is the entire point.
      result.skipped += 1
      continue
    }
    result.claimed += 1

    // Reap a row that has already burned the cap before spending another provider call on
    // it. Only a CAUGHT failure writes `dead`, so a row whose sender dies every time never
    // reached that branch: it recorded `sending`, vanished, came back once the lease
    // lapsed, and cycled forever with `attempts` climbing past MAX_ATTEMPTS. Recording the
    // attempt at claim time made that burn visible; this is what acts on it.
    //
    // Reaped here rather than filtered out of `dueOutboxRows`, because a status filter
    // would leave the row neither sendable nor `dead`, which is the exact stranding the
    // lease-based recovery exists to avoid.
    if (row.attempts >= MAX_ATTEMPTS) {
      await deps.markFailed({
        rowId: row.id,
        attempts: row.attempts,
        error: `abandoned after ${String(row.attempts)} attempts without a recorded outcome`,
        dead: true,
        speakerId: row.speakerId,
      })
      result.dead += 1
      continue
    }

    await sendOne(row, deps, result)
  }

  return result
}

async function sendOne(row: OutboxRow, deps: DrainDeps, result: DrainResult): Promise<void> {
  // The attempt this send is. Recorded with the claim rather than only with the outcome,
  // so a sender that dies mid-flight has still spent an attempt and the row walks toward
  // `dead` instead of being picked up forever by every later sweep.
  const attempts = row.attempts + 1

  try {
    // Before the send, never after. A crash past this point leaves the row `sending` with
    // a lease, which is the state `dueOutboxRows` hands back once that lease lapses;
    // recorded after the send there would be nothing to recover and nothing to fence
    // against. A claim write that itself fails falls into the catch below, and the fence
    // decides what happens there: with no holder recorded the outcome is abandoned and the
    // row stays exactly as it was, still due, with no provider call having been made.
    await deps.lease?.record({
      rowId: row.id,
      holder: deps.holder,
      leaseExpiresAt: new Date(deps.nowMs + LEASE_MS).toISOString(),
      attempts,
      speakerId: row.speakerId,
    })

    const attachments = await (deps.buildAttachments?.(row) ?? Promise.resolve(undefined))

    const sent = await deps.send({
      to: row.toEmail,
      subject: row.payload.subject,
      html: row.payload.html,
      attachments,
      // The provider's half of the idempotency contract. Without this, protection 2
      // above (lease expiry allowing a retry) becomes a way to send twice.
      idempotencyKey: row.idempotencyKey,
    })

    if (!(await stillHolds(deps, row.id))) {
      // The mail is out, and so is somebody else's, collapsed at the provider by the
      // shared idempotency key. Whoever holds the row now owns what it says about itself.
      result.fenced += 1
      return
    }

    await deps.markSent(row.id, sent.messageId, new Date(deps.nowMs).toISOString(), row.speakerId)
    result.sent += 1
  } catch (error) {
    if (!(await stillHolds(deps, row.id))) {
      // The write this abandons is the one the fence exists for: a stale sender turning a
      // row somebody else has already sent back into a failure at a higher attempt count.
      result.fenced += 1
      return
    }

    const dead = attempts >= MAX_ATTEMPTS || isPermanent(error)
    await deps.markFailed({
      rowId: row.id,
      attempts,
      error: describe(error),
      dead,
      speakerId: row.speakerId,
    })
    if (dead) {
      result.dead += 1
    } else {
      result.failed += 1
    }
  }
}

/**
 * Whether the row still records this run as its holder.
 *
 * Read-then-compare, and BEST EFFORT for that reason: Airtable has no compare-and-swap,
 * so the row can change between this read and the write that follows it. What it rules
 * out is the wide case, a sender that lost its lease minutes ago during an attachment
 * build. What it cannot rule out is the narrow one, a handover landing inside the gap
 * between the two calls. The Durable Object grant is what keeps that gap rare; nothing
 * here closes it.
 */
async function stillHolds(deps: DrainDeps, rowId: string): Promise<boolean> {
  const lease = deps.lease
  // Nobody recorded a holder, so there is nothing to compare and an unconditional write
  // is the only write on offer.
  if (lease === undefined) return true

  try {
    return (await lease.heldBy(rowId)) === deps.holder
  } catch {
    // An outcome that cannot be fenced is precisely the outcome that might regress a
    // fresher result, so an unreadable row means abandon rather than guess. The row keeps
    // whatever the last successful write left on it and comes back once its lease lapses,
    // where protection 3 makes the repeated provider call safe.
    return false
  }
}

/**
 * A permanent failure stops immediately rather than burning five attempts. A merge
 * field that does not exist and a template that never renders will fail identically
 * on every retry, and retrying them delays the mail that could still succeed.
 */
function isPermanent(error: unknown): boolean {
  if (!isAppError(error)) return false
  if (
    error.id === ErrorIds.MAIL_MERGE_FIELD_UNKNOWN ||
    error.id === ErrorIds.MAIL_TEMPLATE_MISSING ||
    error.id === ErrorIds.MAIL_ICS_INVALID
  ) {
    return true
  }
  return refusedOutright(error.context.status)
}

/**
 * A provider status a retry cannot clear.
 *
 * `sendViaResend` puts the HTTP status in the error's context, and nothing read it, so every
 * rejection counted as transient: a message to an address the provider refuses BY NAME was
 * attempted five times across five sweeps before the row was marked dead. Measured on the
 * deployed base, where fourteen of fifteen rows read `dead` after five attempts against one
 * unchanging 422, "Invalid `to` field. Please use our testing email address instead of
 * domains like `example.com`". Nothing about the sixth attempt would have differed from the
 * first, and in the meantime those rows were re-leased ahead of mail that could have gone.
 *
 * 408 and 429 are the two 4xx a retry genuinely can clear, so they stay transient. 5xx stays
 * transient too, which is what the retry budget is actually for.
 */
function refusedOutright(status: unknown): boolean {
  if (typeof status !== 'number') return false
  if (status === 408 || status === 429) return false
  return status >= 400 && status < 500
}

function describe(error: unknown): string {
  if (isAppError(error)) return `${error.id}: ${error.message}`
  if (error instanceof Error) return error.message
  return String(error)
}

/** Raised when a caller forgets that the holder has to be per-invocation. */
export function assertHolder(holder: string): void {
  if (holder.trim() === '') {
    throw new AppError(ErrorIds.MAIL_SEND_FAIL, 'drain holder must be a unique non-empty id', {})
  }
}
