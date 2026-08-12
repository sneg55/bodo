// Live reads for TaskAssignments and EmailOutbox.
//
// Files used to live here too. They moved to reads-files.ts when the event-scoped read was
// added and this file passed the size budget; the seam is clean, because Files is the one
// table here with no event link.
//
// Each read that a PAGE renders declares its own tags and window; each read a MUTATION
// or the sender uses declares none and is therefore uncached. That split is the whole
// design of this file, and the uncached side is load-bearing twice over: a write that
// decides what to invalidate from a cached read names tags for a row that has since
// moved, and a cached outbox due-list hands a second cron invocation rows the first has
// already sent. See read-cache.ts for why the cache is on the request now.
//
// The same "filter in code, not in a formula" rule applies and is explained at
// the top of reads.ts, and it bites harder here than anywhere else, because every key
// these three tables are queried by (task, speaker, submission, event) is a LINK.
//
// The joins are exported as pure functions so the filtering is unit tested directly.
// Everything that talks to the network is a thin wrapper around one of them.

import { chunk, getClient } from '@/services/airtable/client'
import { anyFieldEquals } from '@/services/airtable/formula'
import {
  mapOutboxRow,
  mapTask,
  mapTaskAssignment,
  mapTaskAssignmentIfIntact,
} from '@/services/airtable/mapping-portal'
import { REVALIDATE, type ReadCache } from '@/services/airtable/read-cache'
import { listByEvent } from '@/services/airtable/reads'
import { optionalText, view } from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import { eventOutboxTag, eventTasksTag, speakerTasksTag } from '@/services/airtable/tags'
import type { OutboxRow, Task, TaskAssignment } from '@/types/domain'
import { hasAirtable } from '@/utils/env'

/** An assignment with its task resolved, because no surface wants one without it. */
export type TaskAssignmentItem = {
  assignment: TaskAssignment
  task: Task
}

/**
 * Join assignments to the event's tasks, keeping only the ones that belong here.
 *
 * An assignment whose task is not in `tasks` is DROPPED rather than treated as a
 * missing link, and the difference from `attachParticipants` in reads.ts is
 * deliberate: `tasks` is one event's tasks, and a speaker who presents at two events
 * legitimately has assignments against the other one's tasks. Throwing would take a
 * portal page down because of a task on a conference the speaker also spoke at.
 *
 * Ordered by due date with the undated last, then by title. A task list with no order
 * reshuffles itself on every read, and the one thing a speaker wants from it is what
 * is due next.
 */
export function taskItems(
  tasks: readonly Task[],
  assignments: readonly TaskAssignment[],
  keep: (assignment: TaskAssignment) => boolean,
): readonly TaskAssignmentItem[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const items: TaskAssignmentItem[] = []

  for (const assignment of assignments) {
    if (!keep(assignment)) continue
    const task = taskById.get(assignment.taskId)
    if (task === undefined) continue
    items.push({ assignment, task })
  }

  return items.sort(byDueThenTitle)
}

function byDueThenTitle(left: TaskAssignmentItem, right: TaskAssignmentItem): number {
  const leftDue = left.task.dueAt
  const rightDue = right.task.dueAt
  if (leftDue !== rightDue) {
    // An undated task sorts last rather than first. It has no deadline, so it is
    // never the thing a speaker has to do next.
    if (leftDue === undefined) return 1
    if (rightDue === undefined) return -1
    return leftDue.localeCompare(rightDue)
  }
  return left.task.title.localeCompare(right.task.title)
}

async function loadTaskGraph(
  eventId: string,
  cache: ReadCache,
  keep: (assignment: TaskAssignment) => boolean,
): Promise<readonly TaskAssignmentItem[]> {
  // Two list calls rather than a per-assignment task lookup: fanning out per row is
  // exactly what section 3.1 says will hit the rate cap.
  const [tasks, assignmentRecords] = await Promise.all([
    listByEvent(TABLES.tasks, eventId, mapTask, { cache }),
    getClient().listAll(TABLES.taskAssignments, cache),
  ])
  // Orphans are skipped rather than thrown on: see `mapTaskAssignmentIfIntact`. One row
  // whose task or speaker had been deleted used to fail this whole read, for every event.
  const assignments = assignmentRecords
    .map(mapTaskAssignmentIfIntact)
    .filter((assignment): assignment is TaskAssignment => assignment !== undefined)
  return taskItems(tasks, assignments, keep)
}

/**
 * Every task assigned to one speaker on one event, contact and submission scoped.
 *
 * Both tags, as the removed `'use cache'` function had: the speaker's own tag so ticking
 * a task off refreshes their portal, and the event's so an organizer fanning tasks out
 * on accept refreshes everybody's without having to know who is affected.
 *
 * `fresh` drops the window, making the request `no-store` (`cacheInit`). It is for the WRITE
 * PATH, which read-cache.ts's header already named as a place this must not be cached: "the
 * round and assignment lookups decide between create, update and skip from their answer".
 * `resolveOwnAssignment` is that lookup, and it was reading the cached list.
 *
 * The 2026-08-12 eval run made it visible: every `Mark complete` on the deployed Worker
 * answered "no such task assignment" for rows the speaker was looking at, across two tasks
 * and two kinds, while the same call against the base returned all ten of that speaker's
 * assignments. Ownership is decided from this answer, so a stale one is not a stale screen:
 * it is a write that refuses work the speaker owns.
 */
export async function listTaskAssignmentsForSpeaker(
  eventId: string,
  speakerId: string,
  fresh = false,
): Promise<readonly TaskAssignmentItem[]> {
  return await loadTaskGraph(
    eventId,
    {
      tags: [speakerTasksTag(speakerId), eventTasksTag(eventId)],
      ...(fresh ? {} : { revalidate: REVALIDATE.edited }),
    },
    (assignment) => assignment.speakerId === speakerId,
  )
}

/** The admin side of the same graph: every assignment on the event. */
export async function listTaskAssignmentsForEvent(
  eventId: string,
): Promise<readonly TaskAssignmentItem[]> {
  return await loadTaskGraph(
    eventId,
    { tags: [eventTasksTag(eventId)], revalidate: REVALIDATE.edited },
    () => true,
  )
}

/**
 * One assignment by record id. Uncached on purpose: the completion write reads it to
 * learn which speaker and submission to invalidate, and a cached answer there would
 * expire somebody else's screen.
 */
export async function getTaskAssignment(assignmentId: string): Promise<TaskAssignment> {
  return mapTaskAssignment(await getClient().getRecord(TABLES.taskAssignments, assignmentId))
}

export async function getTask(taskId: string): Promise<Task> {
  return mapTask(await getClient().getRecord(TABLES.tasks, taskId))
}

/**
 * Rows the sender should attempt now: one event, due, and not already finished.
 *
 * `failed` is included, and leaving it out was a bug rather than a policy. The whole
 * retry design depends on it: `markOutboxFailed` documents that "`failed` is retried
 * once the lease lapses, `dead` never is", and `drain.ts` sets MAX_ATTEMPTS = 5 to
 * decide between them. With only `queued` selected, a row left the due list forever
 * after one failure, so `attempts` could only ever go 0 to 1 and the cap was
 * unreachable. Any transient provider failure lost the mail permanently and silently.
 *
 * `sending` is included too, and the lease is the only thing that holds it back. A claim
 * now persists `status: 'sending'` with `leaseHolder` and `leaseExpiresAt`
 * (`claimOutboxRow`, called from the drain), so an isolate that dies between the claim
 * and the outcome write leaves the row sitting at `sending`. Excluding the status
 * outright would strand exactly that row: never sendable again, never `dead`, and not
 * visible as a failure either. A `sending` row whose lease is still in the future stays
 * out, which is the mid-flight protection that actually mattered, and a lapsed one is due
 * again. The sender that lapsed cannot then overwrite the retry's outcome, because
 * `drainOutbox` compares the recorded holder before it writes.
 *
 * `dead` and `sent` stay excluded, which is the point of having those statuses.
 *
 * The lease check is a pre-filter, not the lock. `claimOnce` and its Durable Object are
 * what actually stop two overlapping sweeps sending the same row; this only avoids
 * handing the drain rows it would certainly fail to claim. An absent `leaseExpiresAt`
 * means no sender holds it, including on a `sending` row: the claim writes both columns
 * in one request, so that combination should not occur, and treating it as recoverable
 * rather than held is the direction that cannot lose mail.
 *
 * `sendAt <= nowIso` is a string comparison, which is correct only because every
 * instant this DAL writes is an ISO-8601 UTC string with the same shape, so
 * lexical order is chronological order. Oldest first, so a backlog drains in the
 * order it was queued rather than newest-first forever.
 */
export function dueOutboxRows(
  rows: readonly OutboxRow[],
  eventId: string | undefined,
  nowIso: string,
  limit: number,
): readonly OutboxRow[] {
  return rows
    .filter(
      (row) =>
        // `undefined` means EVERY event, and it is what the Cron Trigger passes. A trigger
        // carries no parameters, so the sweep used to fall back to `PORTAL_EVENT_ID` and
        // drain that one event's mail forever: on the graded base one event showed 26 sent
        // and 0 queued while a second showed 14 queued, none of them ever attempted. The
        // rows are already read in full here, so covering every event costs no extra
        // request; only the admin "run now" button, which names an event, still narrows.
        (eventId === undefined || row.eventId === eventId) &&
        (row.status === 'queued' || row.status === 'failed' || row.status === 'sending') &&
        row.sendAt <= nowIso &&
        (row.leaseExpiresAt === undefined || row.leaseExpiresAt <= nowIso),
    )
    .sort((left, right) => left.sendAt.localeCompare(right.sendAt))
    .slice(0, limit)
}

/**
 * Never cached, and not because of an oversight. The sender reads this to decide what
 * to send, and a cached due-list would hand a second cron invocation rows the first one
 * has already sent. It passes no `ReadCache`, and `cacheInit` turns that into an
 * explicit `no-store` rather than leaving it to a default, because "uncached" here is a
 * guarantee about duplicate mail and not a preference. Asserted in
 * tests/airtable-read-cache.test.ts.
 */
export async function listDueOutbox(
  eventId: string | undefined,
  nowIso: string,
  limit: number,
): Promise<readonly OutboxRow[]> {
  const records = await getClient().listAll(TABLES.emailOutbox)
  return dueOutboxRows(records.map(mapOutboxRow), eventId, nowIso, limit)
}

/**
 * Every outbox row on one event, for the admin email log.
 *
 * CACHED, unlike `listDueOutbox` directly above, and the contrast is the point rather than
 * an inconsistency: that read decides whether to SEND and must never act on a stale answer,
 * while this one is a report somebody reads. It carries the outbox tag, so every enqueue
 * and every send outcome already expires it (`mutations-outbox.ts`).
 */
export async function listOutboxForEvent(eventId: string): Promise<readonly OutboxRow[]> {
  // The fixture branch: there is no outbox fixture, and without this the email-history
  // page 500s on a clone with an empty `.env` rather than showing an empty log.
  if (!hasAirtable()) return []
  const records = await getClient().listAll(TABLES.emailOutbox, {
    tags: [eventOutboxTag(eventId)],
    revalidate: REVALIDATE.edited,
  })
  return records.map(mapOutboxRow).filter((row) => row.eventId === eventId)
}

/**
 * The holder recorded on one outbox row right now, or undefined when it carries none.
 *
 * Uncached, and for the same reason `listDueOutbox` is rather than as a preference: the
 * sender reads this to decide whether its own outcome write is still the freshest one, so a
 * cached answer would fence against a holder the row has since handed on, which is exactly
 * the mistake the read exists to catch. One record by id, because a sender only ever asks
 * about the row it believes it is holding.
 */
export async function outboxLeaseHolder(rowId: string): Promise<string | undefined> {
  return mapOutboxRow(await getClient().getRecord(TABLES.emailOutbox, rowId)).leaseHolder
}

/**
 * Which of these `idempotencyKey` values the outbox already holds.
 *
 * This one DOES use a formula, because `idempotencyKey` is a real text column rather
 * than a link (see formula.ts). Chunked, because the formula travels in the query
 * string and a fan-out to a whole cohort would otherwise build a URL nobody accepts,
 * and asking for one field keeps each page small.
 */
export async function existingOutboxKeys(keys: readonly string[]): Promise<ReadonlySet<string>> {
  const client = getClient()
  const found = new Set<string>()

  for (const batch of chunk(keys, 25)) {
    const records = await client.listAll(TABLES.emailOutbox, {
      filterByFormula: anyFieldEquals(COL.idempotencyKey, [...batch]),
      fields: [COL.idempotencyKey],
    })
    for (const record of records) {
      // Through `view`, not `record.fields[...]`: a field is only ever looked up by
      // name through a Map here, so a column literally called `__proto__` cannot read
      // off the prototype chain (records.ts).
      const value = optionalText(view(TABLES.emailOutbox, record), COL.idempotencyKey)
      if (value !== undefined) found.add(value)
    }
  }

  return found
}
