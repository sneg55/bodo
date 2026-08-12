// Every way Preview email can say no, and the fact that saying no is not a crash.
//
// `actionFailure` re-throws anything that is not an `AppError` (action-result.ts), so the
// three refusals in decision-preview.ts were throwing a plain `Error` straight out of the
// Server Action. Ticking a row that was in neither queue and pressing PREVIEW EMAIL
// replaced the whole Abstracts page with "This page couldn't load. A server error
// occurred.", and the dialog that exists to show the reason never saw one.
//
// Pinned by asserting the RESOLVED value rather than by catching: a test that only checked
// `errorId` would still pass if the promise rejected first, because it never got that far.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorIds } from '@/constants/errorIds'

const mocks = vi.hoisted(() => ({
  requireEventRole: vi.fn(),
  getEvent: vi.fn(),
  getSubmission: vi.fn(),
  findEmailTemplate: vi.fn(() => Promise.resolve(undefined)),
}))

vi.mock('@/features/auth/wiring', () => ({ requireEventRole: mocks.requireEventRole }))
vi.mock('@/services/airtable/queries', () => ({
  getEvent: mocks.getEvent,
  getSubmission: mocks.getSubmission,
}))
vi.mock('@/services/airtable/reads-comms', () => ({ findEmailTemplate: mocks.findEmailTemplate }))
vi.mock('@/utils/env', () => ({ appUrl: () => 'https://bodo.example' }))

const { previewDecisionEmailAction } = await import('@/features/submissions/decision-preview')

/** A submission staged for acceptance, which is the only shape the preview renders. */
function staged(overrides: Record<string, unknown> = {}) {
  return {
    id: 'recSub1',
    code: 'SESS-1',
    eventId: 'recEvt1',
    title: 'Shipping on Workers',
    status: 'accept_queue' as const,
    submitterId: 'recSpk1',
    notifiedAt: undefined,
    participants: [
      {
        speakerId: 'recSpk1',
        isPrimary: true,
        speaker: { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' },
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) if (typeof fn === 'function') fn.mockReset()
  mocks.requireEventRole.mockResolvedValue({ role: 'admin' })
  mocks.getEvent.mockResolvedValue({ name: 'AI Engineer Sandbox', slug: 'ai-engineer-sandbox' })
  mocks.findEmailTemplate.mockResolvedValue(undefined)
})

describe('a submission that is in neither queue', () => {
  it('comes back as a failure the dialog can render, not as a thrown 500', async () => {
    mocks.getSubmission.mockResolvedValue(staged({ status: 'pending' }))

    const result = await previewDecisionEmailAction({
      eventId: 'recEvt1',
      submissionId: 'recSub1',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errorId).toBe(ErrorIds.SUB_NOT_STAGED)
    expect(result.message).toContain('not staged for a decision')
  })
})

describe('a submission id from another event', () => {
  it('refuses without reading the event or the template', async () => {
    mocks.getSubmission.mockResolvedValue(staged({ eventId: 'recEvtOther' }))

    const result = await previewDecisionEmailAction({
      eventId: 'recEvt1',
      submissionId: 'recSub1',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errorId).toBe(ErrorIds.DATA_RECORD_NOT_FOUND)
    expect(mocks.getEvent).not.toHaveBeenCalled()
  })
})

describe('a staged decline whose submitter is not on the roster', () => {
  it('reports that there is nobody to notify', async () => {
    // A decline mails the submitter alone, so a roster without them renders no rows at
    // all. Reachable on a real record: the primary participant can be removed after the
    // submission was staged.
    mocks.getSubmission.mockResolvedValue(
      staged({ status: 'decline_queue', submitterId: 'recSpkGone' }),
    )

    const result = await previewDecisionEmailAction({
      eventId: 'recEvt1',
      submissionId: 'recSub1',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errorId).toBe(ErrorIds.SUB_NO_RECIPIENTS)
  })
})

describe('a staged accept with a recipient', () => {
  it('still renders the mail, so the refusals above are not the only path', async () => {
    mocks.getSubmission.mockResolvedValue(staged())

    const result = await previewDecisionEmailAction({
      eventId: 'recEvt1',
      submissionId: 'recSub1',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.toEmail).toBe('ada@example.com')
    expect(result.recipientCount).toBe(1)
    expect(result.source).toBe('system')
  })
})
