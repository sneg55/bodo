// `Generate Download`: what it authorizes, what it claims, and what it queues.
//
// The reference makes this asynchronous, so the observable result of pressing the button is
// one EmailOutbox row, and everything that can go wrong is about that row: the wrong subject,
// two rows for one press, or a row for a caller with no membership. Each is asserted here
// against real function calls with the collaborators mocked, since the collaborators are all
// Airtable, a Durable Object and a session cookie.
//
// `claimOnce` is the exactly-once mechanism, and the test that matters most is the second one:
// a refused claim must return success WITHOUT queueing, because the winner is already doing it
// and telling the organizer their download failed would make them press again.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireEventRole: vi.fn(),
  loadBundleCandidates: vi.fn(),
  readTeamMembers: vi.fn(),
  getEvent: vi.fn(),
  enqueueEmails: vi.fn(),
  claimOnce: vi.fn(),
}))

vi.mock('@/features/auth/wiring', () => ({ requireEventRole: mocks.requireEventRole }))
vi.mock('@/features/bundle/reads', () => ({ loadBundleCandidates: mocks.loadBundleCandidates }))
vi.mock('@/features/team/reads', () => ({ readTeamMembers: mocks.readTeamMembers }))
vi.mock('@/services/airtable/queries', () => ({ getEvent: mocks.getEvent }))
vi.mock('@/services/airtable/mutations-outbox', () => ({ enqueueEmails: mocks.enqueueEmails }))
vi.mock('@/utils/cf', () => ({ claimOnce: mocks.claimOnce }))
vi.mock('@/utils/env', () => ({ appUrl: () => 'https://bodo.test' }))

const { requestFileBundle } = await import('@/features/bundle/request')
const { BUNDLE_EMAIL_SUBJECT } = await import('@/features/bundle/email')

const NOW_MS = Date.parse('2026-08-09T11:22:33.000Z')

const REQUEST = {
  eventId: 'rec-event-1',
  sessionIds: ['sub-1', 'sub-2'],
  grouping: 'session' as const,
  deselectedFileIds: [],
}

function candidates(over: { problem?: 'empty' | 'too-many'; files?: number } = {}) {
  const files = Array.from({ length: over.files ?? 2 }, (_unused, at) => ({
    id: `f-${String(at)}`,
    objectKey: `slides/rec-speaker-ana/f-${String(at)}-deck.pdf`,
    filename: 'deck.pdf',
    size: 1024,
    kind: 'slides' as const,
    sessionId: 'sub-1',
    sessionLabel: 'SESS-1 Scaling Postgres',
    speakerLabel: 'Ana Ruiz',
  }))
  return {
    scope: { sessionIds: REQUEST.sessionIds, foreign: 0, problem: over.problem },
    files: over.problem === undefined ? files : [],
    speakerIds: ['rec-speaker-ana'],
    sessionCount: 2,
  }
}

type QueuedRow = {
  toEmail: string
  idempotencyKey: string
  templateSource: string
  payload: { subject: string; html: string }
}

/** The single outbox row the last call queued. */
function queuedRow(): QueuedRow {
  const rows = mocks.enqueueEmails.mock.calls.at(0)?.at(0) as readonly QueuedRow[] | undefined
  const row = rows?.at(0)
  if (row === undefined) throw new Error('nothing was queued')
  return row
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireEventRole.mockResolvedValue({ userId: 'usr-1', role: 'admin' })
  mocks.loadBundleCandidates.mockResolvedValue(candidates())
  mocks.readTeamMembers.mockResolvedValue([
    { userId: 'usr-other', email: 'other@example.com' },
    { userId: 'usr-1', email: 'organizer@example.com' },
  ])
  mocks.getEvent.mockResolvedValue({ id: 'rec-event-1', name: 'AI.Engineer Sandbox' })
  mocks.claimOnce.mockResolvedValue({ granted: true })
  mocks.enqueueEmails.mockResolvedValue({ queued: 1, skipped: 0 })
})

describe('requestFileBundle authorization', () => {
  it('asks for a role on the event before reading anything', async () => {
    await requestFileBundle(REQUEST, NOW_MS)

    expect(mocks.requireEventRole).toHaveBeenCalledWith('rec-event-1', 'reviewer')
  })

  it('queues nothing when the role check refuses', async () => {
    mocks.requireEventRole.mockRejectedValue(new Error('role reviewer is required'))

    await expect(requestFileBundle(REQUEST, NOW_MS)).rejects.toThrow()
    expect(mocks.enqueueEmails).not.toHaveBeenCalled()
  })

  it('refuses when the acting user has no address to send to', async () => {
    mocks.readTeamMembers.mockResolvedValue([{ userId: 'usr-1', email: '' }])

    await expect(requestFileBundle(REQUEST, NOW_MS)).rejects.toThrow(/no email address/)
    expect(mocks.enqueueEmails).not.toHaveBeenCalled()
  })
})

describe('requestFileBundle scope', () => {
  it('refuses an empty tick set with the instruction rather than a bare error', async () => {
    mocks.loadBundleCandidates.mockResolvedValue(candidates({ problem: 'empty' }))

    await expect(requestFileBundle(REQUEST, NOW_MS)).rejects.toThrow(/Select the abstracts/)
  })

  it('refuses a selection past the cap', async () => {
    mocks.loadBundleCandidates.mockResolvedValue(candidates({ problem: 'too-many' }))

    await expect(requestFileBundle(REQUEST, NOW_MS)).rejects.toThrow(/at most/)
  })

  it('refuses a selection whose sessions have no files', async () => {
    mocks.loadBundleCandidates.mockResolvedValue(candidates({ files: 0 }))

    await expect(requestFileBundle(REQUEST, NOW_MS)).rejects.toThrow(/no files attached/)
    expect(mocks.claimOnce).not.toHaveBeenCalled()
  })

  // The same modal opens from Abstracts, Sessions and View All. All three refusals said
  // "abstracts" whatever the organizer was looking at, which is the half of the finding that
  // the dialog's own inline copy fixed only on its side: these reach the browser as a toast
  // when the selection changes between the modal's read and the press.
  it('names the surface the organizer is on, not always abstracts', async () => {
    mocks.loadBundleCandidates.mockResolvedValue(candidates({ problem: 'empty' }))
    await expect(requestFileBundle(REQUEST, NOW_MS, 'sessions')).rejects.toThrow(
      /Select the sessions/,
    )

    mocks.loadBundleCandidates.mockResolvedValue(candidates({ problem: 'too-many' }))
    await expect(requestFileBundle(REQUEST, NOW_MS, 'all')).rejects.toThrow(
      /at most \d+ submissions/,
    )

    mocks.loadBundleCandidates.mockResolvedValue(candidates({ files: 0 }))
    await expect(requestFileBundle(REQUEST, NOW_MS, 'sessions')).rejects.toThrow(
      /The selected sessions have no files/,
    )
  })
})

describe('requestFileBundle delivery', () => {
  it('queues one row to the acting organizer with the reference subject', async () => {
    const outcome = await requestFileBundle(REQUEST, NOW_MS)

    expect(mocks.enqueueEmails).toHaveBeenCalledTimes(1)
    expect(queuedRow().toEmail).toBe('organizer@example.com')
    expect(queuedRow().payload.subject).toBe(BUNDLE_EMAIL_SUBJECT)
    expect(outcome.toEmail).toBe('organizer@example.com')
    expect(outcome.alreadyQueued).toBe(false)
  })

  it('puts an absolute download link carrying the selection into the body', async () => {
    await requestFileBundle(REQUEST, NOW_MS)
    const html = queuedRow().payload.html

    expect(html).toContain('https://bodo.test/api/files/bundle?')
    expect(html).toContain('sessions=sub-1%2Csub-2')
    expect(html).toContain('group=session')
  })

  it('marks the row as system rather than borrowing a template', async () => {
    await requestFileBundle(REQUEST, NOW_MS)

    expect(queuedRow().templateSource).toBe('system')
  })

  it('claims before it queues, keyed on the request, the REQUESTER and the minute', async () => {
    await requestFileBundle(REQUEST, NOW_MS)
    const [key, holder, ttl] = mocks.claimOnce.mock.calls.at(0) ?? []

    // The user id is in the key. Without it two organizers asking for the same selection in the
    // same minute shared one claim and one outbox row, so the second was told an email was on its
    // way to their address when nothing had been queued for them. Sixteen hex digits, not eight:
    // see `bundleRequestId`. Found by Codex review.
    expect(key).toMatch(/^bundle:[0-9a-f]{16}:usr-1:2026-08-09T11:22$/)
    expect(holder).toEqual(expect.any(String))
    expect(ttl).toBe(60_000)
  })

  it('still enqueues when the claim was not granted, because a claim is not a receipt', async () => {
    // The claim is taken BEFORE the outbox write, so a request that died in between left the claim
    // held with no row behind it, and every retry inside the TTL was answered "already queued"
    // while the email was gone for good. `enqueueEmails` upserts on `idempotencyKey`, so running
    // it on this path repairs the lost work and cannot double-write. Found by Codex review.
    mocks.claimOnce.mockResolvedValue({ granted: false, heldBy: 'someone-else' })

    const outcome = await requestFileBundle(REQUEST, NOW_MS)

    expect(mocks.enqueueEmails).toHaveBeenCalledTimes(1)
    expect(outcome.fileCount).toBe(2)
    // The outbox is what decides the answer now, and this mock reports a fresh write.
    expect(outcome.alreadyQueued).toBe(false)
  })

  it('reports already queued when the outbox says the row was there, claim or no claim', async () => {
    mocks.claimOnce.mockResolvedValue({ granted: false, heldBy: 'someone-else' })
    mocks.enqueueEmails.mockResolvedValue({ queued: 0, skipped: 1 })

    expect((await requestFileBundle(REQUEST, NOW_MS)).alreadyQueued).toBe(true)
  })

  it('reports already queued when the outbox skipped the key it had seen before', async () => {
    mocks.enqueueEmails.mockResolvedValue({ queued: 0, skipped: 1 })

    expect((await requestFileBundle(REQUEST, NOW_MS)).alreadyQueued).toBe(true)
  })

  it('uses the same string for the claim and the outbox key, so the two agree', async () => {
    await requestFileBundle(REQUEST, NOW_MS)

    expect(queuedRow().idempotencyKey).toBe(mocks.claimOnce.mock.calls.at(0)?.at(0))
  })

  it('gives a later minute a different key, so a deliberate retry sends again', async () => {
    await requestFileBundle(REQUEST, NOW_MS)
    const first = mocks.claimOnce.mock.calls.at(0)?.at(0)

    vi.clearAllMocks()
    mocks.requireEventRole.mockResolvedValue({ userId: 'usr-1', role: 'admin' })
    mocks.loadBundleCandidates.mockResolvedValue(candidates())
    mocks.readTeamMembers.mockResolvedValue([{ userId: 'usr-1', email: 'organizer@example.com' }])
    mocks.getEvent.mockResolvedValue({ id: 'rec-event-1', name: 'AI.Engineer Sandbox' })
    mocks.claimOnce.mockResolvedValue({ granted: true })
    mocks.enqueueEmails.mockResolvedValue({ queued: 1, skipped: 0 })

    await requestFileBundle(REQUEST, NOW_MS + 61_000)

    expect(mocks.claimOnce.mock.calls.at(0)?.at(0)).not.toBe(first)
  })
})
