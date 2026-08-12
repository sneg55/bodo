// What Notify reports back, which is the only thing an organizer can act on.
//
// The per-row guard that stops one bad submission stranding the rest also created a way
// to lie: a guarded failure returns a successful ActionResult, so anything the counts do
// not say is invisible. Two defects of exactly that shape were found by review rather
// than by any test, and both are pinned here.
//
//   1. `queuedEmails` was incremented only after the status write, so a row whose mail
//      was queued and whose status write then failed reported zero emails. Those messages
//      exist and the drain will send them, so the report claimed the opposite of the truth.
//   2. A row that failed had to be distinguishable from a row that was never staged.
//      Folding both into `skipped` is how a half-applied batch reads as a clean one.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireEventRole: vi.fn(),
  getEvent: vi.fn(),
  listSubmissions: vi.fn(),
  enqueueOutbox: vi.fn(),
  setSubmissionStatus: vi.fn(),
  /** `EmailTemplates[key=accepted|rejected]`. No row, so the built-in body sends. */
  findEmailTemplate: vi.fn(() => Promise.resolve(undefined)),
}))

vi.mock('@/features/auth/wiring', () => ({ requireEventRole: mocks.requireEventRole }))
vi.mock('@/services/airtable/queries', () => ({
  getEvent: mocks.getEvent,
  listSubmissions: mocks.listSubmissions,
}))
vi.mock('@/services/airtable/mutations', () => ({
  setSubmissionStatus: mocks.setSubmissionStatus,
}))
vi.mock('@/features/submissions/decision-outbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/submissions/decision-outbox')>()
  return { ...actual, enqueueOutbox: mocks.enqueueOutbox }
})
vi.mock('@/services/airtable/reads-comms', () => ({
  findEmailTemplate: mocks.findEmailTemplate,
}))
vi.mock('@/utils/env', () => ({ appUrl: () => 'https://bodo.example' }))

const { notifyQueuedAction } = await import('@/features/submissions/decisions')

/** A submission staged for acceptance, which is what Notify acts on. */
function staged(id: string, code: string) {
  return {
    id,
    code,
    eventId: 'recEvt1',
    title: `Talk ${code}`,
    status: 'accept_queue' as const,
    submitterId: 'recSpk1',
    participants: [
      {
        speakerId: 'recSpk1',
        isPrimary: true,
        speaker: { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' },
      },
    ],
  }
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) if (typeof fn === 'function') fn.mockReset()
  mocks.requireEventRole.mockResolvedValue({ role: 'admin' })
  mocks.getEvent.mockResolvedValue({ name: 'AI Engineer Sandbox', slug: 'ai-engineer-sandbox' })
  mocks.enqueueOutbox.mockResolvedValue(1)
  mocks.setSubmissionStatus.mockResolvedValue(undefined)
})

describe('a status write that fails after the mail was queued', () => {
  it('still reports the queued emails, because those messages exist', async () => {
    mocks.listSubmissions.mockResolvedValue([staged('recSub1', 'SESS-1')])
    mocks.setSubmissionStatus.mockRejectedValue(new Error('Airtable 500'))

    const result = await notifyQueuedAction({ eventId: 'recEvt1', submissionIds: ['recSub1'] })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The row did not commit, so it is not `changed`, and it IS a failure. But one email
    // is genuinely queued and the drain will send it.
    expect(result.queuedEmails).toBe(1)
    expect(result.changed).toBe(0)
    expect(result.failedCodes).toEqual(['SESS-1'])
  })
})

describe('one unfixable row among several', () => {
  it('does not stop the others and names the one that failed', async () => {
    mocks.listSubmissions.mockResolvedValue([
      staged('recSub1', 'SESS-1'),
      staged('recSub2', 'SESS-2'),
      staged('recSub3', 'SESS-3'),
    ])
    mocks.enqueueOutbox
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('merge field missing'))
      .mockResolvedValueOnce(1)

    const result = await notifyQueuedAction({
      eventId: 'recEvt1',
      submissionIds: ['recSub1', 'recSub2', 'recSub3'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(2)
    expect(result.failedCodes).toEqual(['SESS-2'])
    // The third row is the one that used to be abandoned.
    expect(mocks.setSubmissionStatus).toHaveBeenCalledTimes(2)
  })

  it('keeps a failure out of `skipped`, which counts only rows that were never staged', async () => {
    const notStaged = { ...staged('recSub2', 'SESS-2'), status: 'pending' as const }
    mocks.listSubmissions.mockResolvedValue([staged('recSub1', 'SESS-1'), notStaged])
    mocks.enqueueOutbox.mockRejectedValue(new Error('boom'))

    const result = await notifyQueuedAction({
      eventId: 'recEvt1',
      submissionIds: ['recSub1', 'recSub2'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // One never staged, one staged and failed. Conflating them would report a clean batch.
    expect(result.skipped).toBe(1)
    expect(result.failedCodes).toEqual(['SESS-1'])
  })
})

describe('a retried Notify after a status write failed', () => {
  it('computes the same keys, so the enqueue drops the duplicates', async () => {
    // The row is still staged (its status write failed), so a second press reaches the
    // enqueue again. If the key took the new clock reading, that press would write a
    // second copy of every message and the provider key could not collapse them.
    mocks.listSubmissions.mockResolvedValue([staged('recSub1', 'SESS-1')])
    mocks.setSubmissionStatus.mockRejectedValue(new Error('Airtable 500'))

    await notifyQueuedAction({ eventId: 'recEvt1', submissionIds: ['recSub1'] })
    const firstKeys = keysFrom(0)

    await notifyQueuedAction({ eventId: 'recEvt1', submissionIds: ['recSub1'] })
    const secondKeys = keysFrom(1)

    expect(secondKeys).toEqual(firstKeys)
  })

  it('uses a different key once a decision has actually been notified and remade', async () => {
    // A row carrying a stored notifiedAt is superseding it, so this is a new message and
    // must send. That is what the timestamp in the key is for.
    const remade = { ...staged('recSub1', 'SESS-1'), notifiedAt: '2026-08-01T00:00:00.000Z' }
    mocks.listSubmissions.mockResolvedValueOnce([staged('recSub1', 'SESS-1')])
    await notifyQueuedAction({ eventId: 'recEvt1', submissionIds: ['recSub1'] })
    const neverNotified = keysFrom(0)

    mocks.listSubmissions.mockResolvedValueOnce([remade])
    await notifyQueuedAction({ eventId: 'recEvt1', submissionIds: ['recSub1'] })

    expect(keysFrom(1)).not.toEqual(neverNotified)
  })
})

/** The idempotency keys handed to the enqueue on the nth call. */
function keysFrom(call: number): readonly string[] {
  const rows = mocks.enqueueOutbox.mock.calls.at(call)?.[0] as
    | readonly { idempotencyKey: string }[]
    | undefined
  return (rows ?? []).map((row) => row.idempotencyKey)
}

describe('the clean case', () => {
  it('reports no failures when every row commits', async () => {
    mocks.listSubmissions.mockResolvedValue([staged('recSub1', 'SESS-1')])

    const result = await notifyQueuedAction({ eventId: 'recEvt1', submissionIds: ['recSub1'] })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result).toMatchObject({ changed: 1, skipped: 0, queuedEmails: 1, failedCodes: [] })
  })
})

// CFP-14: a row an organizer landed on `accepted` by picking it straight off the status
// chip, skipping the queue and Notify both. `commitTarget` does not recognise it, because
// there is nothing left to COMMIT; what it needs is the mail Notify never got a chance to
// send. Re-entry has to work without ever risking a second copy of a mail already sent.
describe('a decided row that was never notified', () => {
  it('is notified, though it never sat in a queue', async () => {
    const decidedDirectly = { ...staged('recSub1', 'SESS-1'), status: 'accepted' as const }
    mocks.listSubmissions.mockResolvedValue([decidedDirectly])

    const result = await notifyQueuedAction({ eventId: 'recEvt1', submissionIds: ['recSub1'] })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result).toMatchObject({ changed: 1, skipped: 0, queuedEmails: 1, failedCodes: [] })
    // The status write restamps `notifiedAt`; it does not need to move the status, since
    // the row is already where it belongs.
    expect(mocks.setSubmissionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'accepted' }),
    )
  })

  it('works the same for a direct decline', async () => {
    const declinedDirectly = { ...staged('recSub1', 'SESS-1'), status: 'declined' as const }
    mocks.listSubmissions.mockResolvedValue([declinedDirectly])

    const result = await notifyQueuedAction({ eventId: 'recEvt1', submissionIds: ['recSub1'] })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result).toMatchObject({ changed: 1, queuedEmails: 1, failedCodes: [] })
  })
})

describe('a decided row that was already notified', () => {
  it('is skipped rather than mailed a second time', async () => {
    const alreadyNotified = {
      ...staged('recSub1', 'SESS-1'),
      status: 'accepted' as const,
      notifiedAt: '2026-08-01T00:00:00.000Z',
    }
    mocks.listSubmissions.mockResolvedValue([alreadyNotified])

    const result = await notifyQueuedAction({ eventId: 'recEvt1', submissionIds: ['recSub1'] })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result).toMatchObject({ changed: 0, skipped: 1, queuedEmails: 0 })
    expect(mocks.enqueueOutbox).not.toHaveBeenCalled()
    expect(mocks.setSubmissionStatus).not.toHaveBeenCalled()
  })
})

// CFP-14's second half: the actual send used to pick a decline's recipient by `isPrimary`
// while the preview picked it by `submitterId`. Pinned here at the level an organizer would
// notice it at: a decline whose primary speaker is not the submitter must still mail
// somebody, not silently report a clean batch with zero emails queued.
describe('a decline whose primary speaker is not the submitter', () => {
  it('still mails the submitter, not nobody', async () => {
    const coPresenterIsPrimary = {
      ...staged('recSub1', 'SESS-1'),
      status: 'decline_queue' as const,
      submitterId: 'recSpk1',
      participants: [
        {
          speakerId: 'recSpk1',
          isPrimary: false,
          speaker: { email: 'submitter@example.com', firstName: 'Sam', lastName: 'Submitter' },
        },
        {
          speakerId: 'recSpk2',
          isPrimary: true,
          speaker: { email: 'presenter@example.com', firstName: 'Pat', lastName: 'Presenter' },
        },
      ],
    }
    mocks.listSubmissions.mockResolvedValue([coPresenterIsPrimary])

    const result = await notifyQueuedAction({ eventId: 'recEvt1', submissionIds: ['recSub1'] })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.queuedEmails).toBe(1)
    const rows = mocks.enqueueOutbox.mock.calls.at(0)?.[0] as readonly { toEmail: string }[]
    expect(rows.map((row) => row.toEmail)).toEqual(['submitter@example.com'])
  })
})
