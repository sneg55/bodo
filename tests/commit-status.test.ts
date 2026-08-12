// `commitStatus` is the one place every status move funnels through (this file's own
// header explains why), so it is also the one place that can reconcile a submission's
// track the moment it becomes a session. This covers that wiring in isolation:
// `track-repair.ts` (its own tests) owns whether the CORRECTION is right, this owns WHEN
// `commitStatus` reaches for it, and that a reconciliation failure never stops an accept.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { form, submission } from './helpers/portal-fakes'

const mocks = vi.hoisted(() => ({
  setSubmissionStatus: vi.fn(),
  announceStatusChange: vi.fn(),
  listForms: vi.fn(),
  applyTrackFix: vi.fn(),
}))

vi.mock('@/services/airtable/mutations', () => ({
  setSubmissionStatus: mocks.setSubmissionStatus,
}))
vi.mock('@/services/airtable/queries', () => ({ listForms: mocks.listForms }))
vi.mock('@/features/webhooks/announce', () => ({
  announceStatusChange: mocks.announceStatusChange,
}))
vi.mock('@/features/submissions/track-repair', () => ({ applyTrackFix: mocks.applyTrackFix }))

const { commitStatus } = await import('@/features/submissions/commit-status')

const CFP_FORM = form({ id: 'recForm1' })

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset()
  mocks.setSubmissionStatus.mockResolvedValue(undefined)
  mocks.announceStatusChange.mockResolvedValue(undefined)
})

describe('moving a submission to accepted', () => {
  it('looks up its form and applies the track fix', async () => {
    const row = submission({ status: 'accept_queue', formId: 'recForm1' })
    mocks.listForms.mockResolvedValue([CFP_FORM])
    mocks.applyTrackFix.mockResolvedValue('recPlatformInfra')

    await commitStatus('recEvent1', row, 'accepted')

    expect(mocks.listForms).toHaveBeenCalledExactlyOnceWith('recEvent1')
    expect(mocks.applyTrackFix).toHaveBeenCalledExactlyOnceWith('recEvent1', row, CFP_FORM)
    // The status write and the announcement still happen either way.
    expect(mocks.setSubmissionStatus).toHaveBeenCalledOnce()
    expect(mocks.announceStatusChange).toHaveBeenCalledOnce()
  })

  it('skips the lookup entirely for a manual submission with no form', async () => {
    const row = submission({ status: 'accept_queue', formId: undefined })

    await commitStatus('recEvent1', row, 'accepted')

    expect(mocks.listForms).not.toHaveBeenCalled()
    expect(mocks.applyTrackFix).not.toHaveBeenCalled()
  })

  it('does nothing when the submitted form no longer resolves', async () => {
    const row = submission({ status: 'accept_queue', formId: 'recDeletedForm' })
    mocks.listForms.mockResolvedValue([CFP_FORM])

    await commitStatus('recEvent1', row, 'accepted')

    expect(mocks.applyTrackFix).not.toHaveBeenCalled()
  })

  it('swallows a reconciliation failure rather than failing the accept', async () => {
    const row = submission({ status: 'accept_queue', formId: 'recForm1' })
    mocks.listForms.mockResolvedValue([CFP_FORM])
    mocks.applyTrackFix.mockRejectedValue(new Error('Airtable 500'))

    await expect(commitStatus('recEvent1', row, 'accepted')).resolves.toBeUndefined()

    // The write and the announcement are not casualties of a track-fix failure.
    expect(mocks.setSubmissionStatus).toHaveBeenCalledOnce()
    expect(mocks.announceStatusChange).toHaveBeenCalledOnce()
  })
})

describe('a move that is not into accepted', () => {
  it('never reaches for the track fix', async () => {
    const row = submission({ status: 'pending', formId: 'recForm1' })

    await commitStatus('recEvent1', row, 'decline_queue')

    expect(mocks.listForms).not.toHaveBeenCalled()
    expect(mocks.applyTrackFix).not.toHaveBeenCalled()
    expect(mocks.setSubmissionStatus).toHaveBeenCalledOnce()
  })

  it('does not reconcile a row that is already accepted and being re-notified', async () => {
    // `commitStatus` is also reached for a row already `accepted` (CFP-14 re-entry, see
    // `decisions.ts`), which still passes `status: 'accepted'` and legitimately should
    // reconcile again - covered by the first describe block. This just confirms a
    // transition to any OTHER status stays silent.
    const row = submission({ status: 'accepted', formId: 'recForm1' })

    await commitStatus('recEvent1', row, 'declined')

    expect(mocks.applyTrackFix).not.toHaveBeenCalled()
  })
})
