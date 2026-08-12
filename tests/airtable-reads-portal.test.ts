// The filtering these reads do in code, because Airtable cannot do it in a formula.
//
// Every key involved (task, speaker, submission, event) is a LINK, and a formula sees a
// linked record as its primary field's TEXT, so `{speaker} = 'recSpk1'` matches nothing
// at all. That makes these joins the actual scoping boundary rather than a convenience:
// a bug in `taskItems` shows one speaker another speaker's tasks, and a bug in
// `dueOutboxRows` sends mail that was scheduled for next week.

import { describe, expect, it } from 'vitest'

import { anyFieldEquals } from '@/services/airtable/formula'
import { dueOutboxRows, taskItems } from '@/services/airtable/reads-portal'
import type { OutboxRow, Task, TaskAssignment } from '@/types/domain'

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    eventId: 'recEvent1',
    title: 'A task',
    entityType: 'contact',
    origin: 'manual',
    kind: 'confirm',
    ...overrides,
  }
}

function assignment(overrides: Partial<TaskAssignment> & { id: string }): TaskAssignment {
  return {
    taskId: 'recTask1',
    speakerId: 'recSpk1',
    status: 'pending',
    ...overrides,
  }
}

describe('taskItems', () => {
  const tasks = [
    task({ id: 'recTask1', title: 'Slides', dueAt: '2026-10-05T00:00:00.000Z' }),
    task({ id: 'recTask2', title: 'Headshot', dueAt: '2026-09-20T00:00:00.000Z' }),
    task({ id: 'recTask3', title: 'Handbook' }),
  ]

  it('attaches the task to each assignment', () => {
    const items = taskItems(tasks, [assignment({ id: 'recA1' })], () => true)
    expect(items).toHaveLength(1)
    expect(items[0]?.task.title).toBe('Slides')
    expect(items[0]?.assignment.id).toBe('recA1')
  })

  it('keeps only the assignments the predicate accepts', () => {
    const items = taskItems(
      tasks,
      [
        assignment({ id: 'recA1', speakerId: 'recSpk1' }),
        assignment({ id: 'recA2', speakerId: 'recSpk2' }),
      ],
      (row) => row.speakerId === 'recSpk1',
    )
    expect(items.map((item) => item.assignment.id)).toEqual(['recA1'])
  })

  it('DROPS an assignment whose task belongs to another event', () => {
    // Not an error, deliberately. `tasks` is one event's tasks, and a speaker who
    // presents at two conferences legitimately has assignments against the other one's
    // tasks. Throwing would take this portal page down because of a task elsewhere.
    const items = taskItems(
      tasks,
      [assignment({ id: 'recA9', taskId: 'recTaskOther' })],
      () => true,
    )
    expect(items).toEqual([])
  })

  it('orders by due date, with the undated last', () => {
    const items = taskItems(
      tasks,
      [
        assignment({ id: 'recA1', taskId: 'recTask3' }),
        assignment({ id: 'recA2', taskId: 'recTask1' }),
        assignment({ id: 'recA3', taskId: 'recTask2' }),
      ],
      () => true,
    )
    // Headshot (Sep 20), Slides (Oct 5), then the undated Handbook: an undated task has
    // no deadline, so it is never the thing a speaker has to do next.
    expect(items.map((item) => item.task.title)).toEqual(['Headshot', 'Slides', 'Handbook'])
  })

  it('breaks a tie on title, so the list does not reshuffle between reads', () => {
    const sameDay = [
      task({ id: 'recT1', title: 'Zebra', dueAt: '2026-10-05T00:00:00.000Z' }),
      task({ id: 'recT2', title: 'Aardvark', dueAt: '2026-10-05T00:00:00.000Z' }),
    ]
    const items = taskItems(
      sameDay,
      [assignment({ id: 'recA1', taskId: 'recT1' }), assignment({ id: 'recA2', taskId: 'recT2' })],
      () => true,
    )
    expect(items.map((item) => item.task.title)).toEqual(['Aardvark', 'Zebra'])
  })

  it('keeps one row per submission for a submission-scoped task', () => {
    // Section 3 makes TaskAssignments unique on (task, speaker, submission) precisely
    // so a speaker with two accepted submissions gets two rows for "upload slides".
    const items = taskItems(
      tasks,
      [
        assignment({ id: 'recA1', submissionId: 'recSub1' }),
        assignment({ id: 'recA2', submissionId: 'recSub2' }),
      ],
      () => true,
    )
    expect(items.map((item) => item.assignment.submissionId)).toEqual(['recSub1', 'recSub2'])
  })
})

function outbox(overrides: Partial<OutboxRow> & { id: string }): OutboxRow {
  return {
    eventId: 'recEvent1',
    templateSource: 'system',
    idempotencyKey: `key-${overrides.id}`,
    payload: { subject: 's', html: 'h', attachIcs: false },
    toEmail: 'ada@example.com',
    sendAt: '2026-08-08T09:00:00.000Z',
    status: 'queued',
    attempts: 0,
    ...overrides,
  }
}

describe('dueOutboxRows', () => {
  const now = '2026-08-08T12:00:00.000Z'

  it('takes queued rows that are due, oldest first', () => {
    const rows = dueOutboxRows(
      [
        outbox({ id: 'r1', sendAt: '2026-08-08T11:00:00.000Z' }),
        outbox({ id: 'r2', sendAt: '2026-08-08T10:00:00.000Z' }),
      ],
      'recEvent1',
      now,
      10,
    )
    // Oldest first, so a backlog drains in the order it was queued rather than
    // newest-first forever while the oldest row starves.
    expect(rows.map((row) => row.id)).toEqual(['r2', 'r1'])
  })

  it('leaves a row scheduled for later alone', () => {
    const rows = dueOutboxRows(
      [outbox({ id: 'r1', sendAt: '2026-08-09T00:00:00.000Z' })],
      'recEvent1',
      now,
      10,
    )
    expect(rows).toEqual([])
  })

  it('includes a row due exactly now', () => {
    expect(dueOutboxRows([outbox({ id: 'r1', sendAt: now })], 'recEvent1', now, 10)).toHaveLength(1)
  })

  it('returns queued and failed rows, and skips the terminal and the held ones', () => {
    const rows = dueOutboxRows(
      [
        outbox({ id: 'r1', status: 'sending', leaseExpiresAt: '2026-08-08T12:30:00.000Z' }),
        outbox({ id: 'r2', status: 'sent' }),
        outbox({ id: 'r3', status: 'failed' }),
        outbox({ id: 'r4', status: 'dead' }),
        outbox({ id: 'r5', status: 'queued' }),
      ],
      'recEvent1',
      now,
      10,
    )
    // This test used to assert `['r5']`, which encoded a bug rather than a decision:
    // excluding `failed` meant a row left the due list forever after one failure, so
    // `drain.ts`'s MAX_ATTEMPTS = 5 was unreachable and any transient provider error
    // lost the mail. `failed` is retryable by design, and `markOutboxFailed` says so.
    //
    // `sent` is done and `dead` is the attempt cap having been reached, so both stay out
    // by status. `sending` no longer does, and r1 carries a live lease here where it used
    // to carry none: the claim write persists `sending` (`claimOutboxRow`), so excluding
    // that status outright would strand every row whose sender died mid-flight, neither
    // sendable nor `dead`. What keeps r1 out is the lease still being in the future, which
    // is the mid-flight protection this case was always really about.
    expect(rows.map((row) => row.id)).toEqual(['r3', 'r5'])
  })

  it('returns a sending row once its lease has lapsed', () => {
    const rows = dueOutboxRows(
      [outbox({ id: 'r1', status: 'sending', leaseExpiresAt: '2026-08-08T11:00:00.000Z' })],
      'recEvent1',
      now,
      10,
    )
    expect(rows.map((row) => row.id)).toEqual(['r1'])
  })

  it('never crosses events', () => {
    const rows = dueOutboxRows(
      [outbox({ id: 'r1' }), outbox({ id: 'r2', eventId: 'recEvent2' })],
      'recEvent1',
      now,
      10,
    )
    expect(rows.map((row) => row.id)).toEqual(['r1'])
  })

  it('honours the limit, keeping the oldest', () => {
    const rows = dueOutboxRows(
      [
        outbox({ id: 'r1', sendAt: '2026-08-08T11:00:00.000Z' }),
        outbox({ id: 'r2', sendAt: '2026-08-08T10:00:00.000Z' }),
        outbox({ id: 'r3', sendAt: '2026-08-08T09:00:00.000Z' }),
      ],
      'recEvent1',
      now,
      2,
    )
    expect(rows.map((row) => row.id)).toEqual(['r3', 'r2'])
  })
})

describe('anyFieldEquals', () => {
  it('builds one OR over the keys being looked up', () => {
    expect(anyFieldEquals('idempotencyKey', ['a', 'b'])).toBe(
      "OR({idempotencyKey} = 'a', {idempotencyKey} = 'b')",
    )
  })

  it('escapes a value rather than letting it end the string early', () => {
    // Airtable answers a malformed filter by IGNORING it and returning the whole table,
    // so an unescaped quote here would turn a key lookup into a full scan that reports
    // every key as already taken.
    expect(anyFieldEquals('idempotencyKey', ["O'Neil"])).toBe("OR({idempotencyKey} = 'O\\'Neil')")
  })

  it('matches nothing when asked about nothing', () => {
    // `OR()` is a syntax error Airtable would ignore, and ignoring it returns
    // everything, which is the opposite of the answer.
    expect(anyFieldEquals('idempotencyKey', [])).toBe('FALSE()')
  })
})
