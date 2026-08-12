// The organizer-facing control's write (`SubmissionDecisionActions.tsx`'s "Use <track>"
// button): authorize, resolve the record and its form, and hand off to `applyTrackFix`.
// Everything the action touches is mocked, including `applyTrackFix` itself - the
// computation and the write it performs are `tests/track-repair.test.ts`'s subject, this
// file's is the sequence of calls around it: who may call it, which record, which form.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError, ErrorIds } from '@/constants/errorIds'

import { form, submission } from './helpers/portal-fakes'

const mocks = vi.hoisted(() => ({
  requireEventRole: vi.fn(),
  getSubmission: vi.fn(),
  listForms: vi.fn(),
  applyTrackFix: vi.fn(),
}))

vi.mock('@/features/auth/wiring', () => ({ requireEventRole: mocks.requireEventRole }))
vi.mock('@/services/airtable/queries', () => ({
  getSubmission: mocks.getSubmission,
  listForms: mocks.listForms,
}))
vi.mock('@/features/submissions/track-repair', () => ({ applyTrackFix: mocks.applyTrackFix }))

const { repairSubmissionTrackAction } = await import('@/features/submissions/track-repair-action')

const CFP_FORM = form({ id: 'recForm1' })

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset()
  mocks.requireEventRole.mockResolvedValue({ role: 'admin' })
})

it('requires admin on the event before touching anything', async () => {
  mocks.requireEventRole.mockRejectedValue(
    new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'not an admin on this event'),
  )

  const result = await repairSubmissionTrackAction({
    eventId: 'recEvent1',
    submissionId: 'recSub1',
  })

  expect(result.ok).toBe(false)
  expect(mocks.getSubmission).not.toHaveBeenCalled()
})

it('refuses a submission that does not belong to the given event', async () => {
  mocks.getSubmission.mockResolvedValue(submission({ eventId: 'recOtherEvent' }))

  const result = await repairSubmissionTrackAction({
    eventId: 'recEvent1',
    submissionId: 'recSub1',
  })

  expect(result.ok).toBe(false)
  expect(mocks.applyTrackFix).not.toHaveBeenCalled()
})

it('does nothing for a manually entered submission with no form', async () => {
  mocks.getSubmission.mockResolvedValue(submission({ formId: undefined }))

  const result = await repairSubmissionTrackAction({
    eventId: 'recEvent1',
    submissionId: 'recSub1',
  })

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.corrected).toBe(false)
  expect(mocks.listForms).not.toHaveBeenCalled()
  expect(mocks.applyTrackFix).not.toHaveBeenCalled()
})

it('does nothing when the form the record was submitted through no longer exists', async () => {
  mocks.getSubmission.mockResolvedValue(submission({ formId: 'recDeletedForm' }))
  mocks.listForms.mockResolvedValue([])

  const result = await repairSubmissionTrackAction({
    eventId: 'recEvent1',
    submissionId: 'recSub1',
  })

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.corrected).toBe(false)
  expect(mocks.applyTrackFix).not.toHaveBeenCalled()
})

it('resolves the form and hands off to applyTrackFix, reporting what it returns', async () => {
  const row = submission({ formId: 'recForm1' })
  mocks.getSubmission.mockResolvedValue(row)
  mocks.listForms.mockResolvedValue([CFP_FORM])
  mocks.applyTrackFix.mockResolvedValue('recPlatformInfra')

  const result = await repairSubmissionTrackAction({
    eventId: 'recEvent1',
    submissionId: 'recSub1',
  })

  expect(mocks.applyTrackFix).toHaveBeenCalledExactlyOnceWith('recEvent1', row, CFP_FORM)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result).toMatchObject({ corrected: true, trackId: 'recPlatformInfra' })
})

it('reports no correction, without a failure, when applyTrackFix finds nothing', async () => {
  mocks.getSubmission.mockResolvedValue(submission({ formId: 'recForm1' }))
  mocks.listForms.mockResolvedValue([CFP_FORM])
  mocks.applyTrackFix.mockResolvedValue(undefined)

  const result = await repairSubmissionTrackAction({
    eventId: 'recEvent1',
    submissionId: 'recSub1',
  })

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.corrected).toBe(false)
})
