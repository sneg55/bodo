// Draft reminders, tested as sweeps rather than as arithmetic.
//
// The sweep runs every five minutes (wrangler.jsonc), so nothing here is a unit of
// date maths: an idempotency key that is not stable sends the same speaker twelve
// reminders an hour, a status that is not re-read emails somebody who already
// submitted, and a key that does not carry the close date leaves a moved deadline
// suppressed forever. Each case below is one of those.

import { describe, expect, it, vi } from 'vitest'

import { idempotencyKeys, type OutboxDraft } from '@/features/comms/triggers'
import {
  type DraftForReminder,
  type DraftReminderInput,
  draftReminderRows,
  enqueueDraftReminders,
  type ReminderEnqueueDeps,
  type ReminderForm,
} from '@/features/jobs/reminders'

const NOW = Date.parse('2026-08-08T12:00:00.000Z')
const EVENT_ID = 'recEvt1'
const FORM_ID = 'recForm1'

/** Close is 12 hours out, so the 72 hour and the 24 hour reminders are both due. */
const CLOSE_BOTH_DUE = new Date(NOW + 12 * 3_600_000).toISOString()

/** Close is 30 hours out: 72 hours before is past, 24 hours before is not. */
const CLOSE_ONLY_72_DUE = new Date(NOW + 30 * 3_600_000).toISOString()

function form(over: Partial<ReminderForm> = {}): ReminderForm {
  return { id: FORM_ID, closeDate: CLOSE_BOTH_DUE, ...over }
}

function draft(over: Partial<DraftForReminder> = {}): DraftForReminder {
  return {
    submissionId: 'recSub1',
    formId: FORM_ID,
    status: 'draft',
    speakerId: 'recSpk1',
    toEmail: 'ada@example.com',
    firstName: 'Ada',
    code: 'SESS-1',
    title: 'Streaming on Workers',
    ...over,
  }
}

function input(over: Partial<DraftReminderInput> = {}): DraftReminderInput {
  return {
    eventId: EVENT_ID,
    eventName: 'AI Engineer Sandbox',
    eventSlug: 'ai-engineer-sandbox',
    portalUrl: 'https://bodo.example.com/portal',
    nowMs: NOW,
    forms: [form()],
    drafts: [draft()],
    ...over,
  }
}

describe('draftReminderRows', () => {
  it('builds the 72 hour and the 24 hour reminder as two rows with different keys', () => {
    // One row per offset, so the second reminder is not collapsed into the first by
    // an upsert on the key.
    const rows = draftReminderRows(input())

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.idempotencyKey)).toEqual([
      idempotencyKeys.draftReminder('recSub1', CLOSE_BOTH_DUE, 72),
      idempotencyKeys.draftReminder('recSub1', CLOSE_BOTH_DUE, 24),
    ])
  })

  it('holds back the reminder whose send time has not arrived', () => {
    // `draftReminderTimes` returns future instants too, and enqueuing one would send
    // the 24 hour reminder two days early.
    const rows = draftReminderRows(input({ forms: [form({ closeDate: CLOSE_ONLY_72_DUE })] }))

    expect(rows).toHaveLength(1)
    expect(rows[0]?.idempotencyKey).toBe(
      idempotencyKeys.draftReminder('recSub1', CLOSE_ONLY_72_DUE, 72),
    )
  })

  it('skips a submission that has left draft since the last sweep', () => {
    const rows = draftReminderRows(input({ drafts: [draft({ status: 'pending' })] }))

    expect(rows).toEqual([])
  })

  it('skips a form with no close date, because the close date is what enables reminders', () => {
    const rows = draftReminderRows(input({ forms: [form({ closeDate: undefined })] }))

    expect(rows).toEqual([])
  })

  it('skips a draft with no form, because there is no deadline to remind about', () => {
    // A manually created submission has no form (Submission.formId is optional).
    const rows = draftReminderRows(input({ drafts: [draft({ formId: undefined })] }))

    expect(rows).toEqual([])
  })

  it('builds a new key when the close date moves, so the reminder re-arms', () => {
    const before = draftReminderRows(input())
    const moved = new Date(NOW + 6 * 3_600_000).toISOString()

    const after = draftReminderRows(input({ forms: [form({ closeDate: moved })] }))

    expect(after.map((row) => row.idempotencyKey)).not.toEqual(
      before.map((row) => row.idempotencyKey),
    )
    expect(after[0]?.idempotencyKey).toContain(moved)
  })

  it('addresses each reminder to the draft owner and carries the submission link', () => {
    const rows = draftReminderRows(
      input({
        drafts: [draft(), draft({ submissionId: 'recSub2', toEmail: 'grace@example.com' })],
      }),
    )

    expect(rows.map((row) => row.toEmail)).toEqual([
      'ada@example.com',
      'ada@example.com',
      'grace@example.com',
      'grace@example.com',
    ])
    expect(rows.every((row) => row.kind === 'submission.draft_reminder')).toBe(true)
    expect(rows.every((row) => row.submissionId !== undefined)).toBe(true)
    expect(rows.every((row) => row.formId === FORM_ID)).toBe(true)
  })

  it('renders the offset into the message, so the two reminders do not read identically', () => {
    const rows = draftReminderRows(input())

    expect(rows[0]?.payload.subject).not.toBe(rows[1]?.payload.subject)
    expect(rows[0]?.payload.html).toContain('Streaming on Workers')
    expect(rows[0]?.payload.attachIcs).toBe(false)
  })

  it('renders a speaker with no first name instead of failing the whole sweep', () => {
    // `renderTemplate` throws on a merge value the context cannot supply, and an
    // empty string counts as absent. One nameless speaker must not be able to stop
    // every other reminder in the run.
    const rows = draftReminderRows(input({ drafts: [draft({ firstName: '  ' })] }))

    expect(rows).toHaveLength(2)
    expect(rows[0]?.payload.html).toContain('<p>Hi ')
  })

  it('sets sendAt to the reminder instant, not to now, so the outbox order is honest', () => {
    const rows = draftReminderRows(input())

    expect(rows[0]?.sendAt).toBe(
      new Date(Date.parse(CLOSE_BOTH_DUE) - 72 * 3_600_000).toISOString(),
    )
  })
})

/** An outbox that already holds keys, which is the only reason a re-run is safe. */
function fakeOutbox() {
  const keys = new Set<string>()
  const enqueue = vi.fn((rows: readonly OutboxDraft[]) => {
    const fresh = rows.filter((row) => !keys.has(row.idempotencyKey))
    for (const row of fresh) keys.add(row.idempotencyKey)
    return Promise.resolve({ queued: fresh.length, skipped: rows.length - fresh.length })
  })
  return { keys, enqueue }
}

function enqueueDeps(over: Partial<ReminderEnqueueDeps> = {}) {
  const table = fakeOutbox()
  return {
    table,
    deps: {
      eventId: EVENT_ID,
      portalUrl: 'https://bodo.example.com/portal',
      nowMs: NOW,
      loadEvent: () =>
        Promise.resolve({ name: 'AI Engineer Sandbox', slug: 'ai-engineer-sandbox' }),
      listForms: () => Promise.resolve([form()]),
      listDrafts: () => Promise.resolve([draft()]),
      enqueue: table.enqueue,
      ...over,
    } satisfies ReminderEnqueueDeps,
  }
}

describe('enqueueDraftReminders', () => {
  it('queues nothing new on a second sweep, because the key has not changed', async () => {
    const { table, deps } = enqueueDeps()

    const first = await enqueueDraftReminders(deps)
    const second = await enqueueDraftReminders({ ...deps, nowMs: NOW + 5 * 60_000 })

    expect(first).toEqual({ queued: 2, skipped: 0 })
    expect(second).toEqual({ queued: 0, skipped: 2 })
    expect(table.keys.size).toBe(2)
  })

  it('queues the re-armed reminder once the close date moves', async () => {
    const { table, deps } = enqueueDeps()
    await enqueueDraftReminders(deps)

    const moved = new Date(NOW + 6 * 3_600_000).toISOString()
    const after = await enqueueDraftReminders({
      ...deps,
      listForms: () => Promise.resolve([form({ closeDate: moved })]),
    })

    expect(after.queued).toBe(2)
    expect(table.keys.size).toBe(4)
  })

  it('does not queue a submission that left draft between two sweeps', async () => {
    const { table, deps } = enqueueDeps({ listDrafts: () => Promise.resolve([]) })

    expect(await enqueueDraftReminders(deps)).toEqual({ queued: 0, skipped: 0 })
    expect(table.enqueue).not.toHaveBeenCalled()
  })

  it('writes nothing at all when nothing is due, rather than an empty upsert', async () => {
    const { table, deps } = enqueueDeps({
      listForms: () => Promise.resolve([form({ closeDate: undefined })]),
    })

    await enqueueDraftReminders(deps)

    expect(table.enqueue).not.toHaveBeenCalled()
  })
})
