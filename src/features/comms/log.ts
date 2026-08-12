// The event's email history: what was queued, what was sent, and what failed.
//
// `EmailOutbox` has held all of this since the comms path shipped and nothing surfaced it,
// so the only way to answer "did the acceptance email go out" was to open Airtable. That
// made three rubric items unverifiable from inside the product: two of them could only be
// checked by hand, and the run scored them `cannot_judge` rather than pass or fail.
//
// It is a LOG and not a mailbox. Nothing here resends, edits or deletes: a row is the
// record of an attempt, and the drain owns every transition between its states. The one
// thing an organizer needs that the table cannot give them directly is why a failure
// happened, so `lastError` is surfaced rather than collapsed into "failed", and
// `failureCount` lets the table offer to open every reason at once: a pattern across forty
// dead rows is the diagnosis, and one reason at a time is not.
//
// The Source column answers "who wrote this", and `EmailLogSource` is where it stops being
// a straight read of the stored column. See its doc.
//
// The payload is snapshotted at enqueue (`OutboxPayload`), which is what makes the subject
// column truthful: it is the subject that was actually sent, not what the template would
// render today.

import { OUTBOX_STATUSES, type OutboxStatus } from '@/constants/status'
import { isCohortKey } from '@/features/comms/triggers'
import { dateTimeText } from '@/features/review/date-text'
import type { OutboxRow, RecordId } from '@/types/domain'

/**
 * Where the words in this message came from, as the log reports it.
 *
 * A superset of `EmailOutbox.templateSource`, and `manual` is the one it adds. The stored
 * column is an Airtable single-select over three options and a hand-composed send is stamped
 * `system` on it (see `bulkEmailRows`), so until this existed an organizer's own message and
 * an automated one were the same word in the Source column. That is the distinction this
 * page is opened to make: "did the system send this, or did one of us".
 *
 * DERIVED rather than stored, and deliberately: it is read off the idempotency key, which
 * only the composer namespaces (`isCohortKey`). That needs no new select option and no
 * migration, and it classifies the sends that already happened rather than only the next
 * ones. See the note on `COHORT_KEY_PREFIX`.
 */
export type EmailLogSource = OutboxRow['templateSource'] | 'manual'

export type EmailLogRow = {
  readonly id: RecordId
  readonly toEmail: string
  readonly subject: string
  readonly status: OutboxStatus
  /** `sentAt` when it went, `sendAt` otherwise: the instant that explains the row. */
  readonly whenText: string
  readonly attempts: number
  /** Present only on a failure, and the whole reason a log beats a status column. */
  readonly lastError?: string
  /** Which authored thing produced it: a person, a template, a form's body, or code. */
  readonly source: EmailLogSource
}

export type EmailLogView = {
  readonly rows: readonly EmailLogRow[]
  readonly counts: Readonly<Record<OutboxStatus, number>>
  /** How many rows failed outright, so the table can offer to open all their reasons. */
  readonly failureCount: number
}

const SOURCE_LABELS: ReadonlyMap<EmailLogSource, string> = new Map([
  ['manual', 'Hand-composed'],
  ['template', 'Template'],
  ['form_inline', 'Form'],
  ['system', 'System'],
])

export function emailSourceLabel(source: EmailLogSource): string {
  return SOURCE_LABELS.get(source) ?? source
}

/**
 * `manual` wins over whatever the row stored, because the key is the more specific fact.
 *
 * The composer stamps `system` on every row it queues, so reading the column first would
 * always answer `System` and the derived value would never be reached.
 */
function sourceOf(row: OutboxRow): EmailLogSource {
  return isCohortKey(row.idempotencyKey) ? 'manual' : row.templateSource
}

/**
 * Newest first, by the instant that explains the row.
 *
 * A sent row is explained by when it SENT and a queued one by when it was due, so ordering
 * on a single column would interleave them meaninglessly: a message queued for next Tuesday
 * would sort above one that went out this morning.
 */
export function buildEmailLog(rows: readonly OutboxRow[], timeZone: string): EmailLogView {
  // Built from the vocabulary rather than spelled out, so a sixth status is a compile
  // error at its definition instead of a column that silently counts nothing. `dead` is
  // the one that matters most to surface: it means the drain gave up retrying.
  const counts = Object.fromEntries(OUTBOX_STATUSES.map((status) => [status, 0])) as Record<
    OutboxStatus,
    number
  >

  const projected = rows.map((row) => {
    counts[row.status] += 1
    const when = row.sentAt ?? row.sendAt
    return {
      id: row.id,
      toEmail: row.toEmail,
      subject: row.payload.subject,
      status: row.status,
      whenText: dateTimeText(when, timeZone),
      attempts: row.attempts,
      lastError: row.lastError,
      source: sourceOf(row),
      sortKey: when,
    }
  })

  return {
    rows: projected
      .sort((left, right) => right.sortKey.localeCompare(left.sortKey))
      .map(({ sortKey: _sortKey, ...row }) => row),
    counts,
    // Counted off `lastError` and not off the status, because the reason is what the table
    // can open: a `dead` row whose provider said nothing has no reason to show.
    failureCount: projected.filter((row) => row.lastError !== undefined).length,
  }
}
