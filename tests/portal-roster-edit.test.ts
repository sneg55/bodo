// The roster edit as a SEQUENCE, which is the half the pure rules cannot pin.
//
// Three orderings decide whether this is correct and none is visible in the happy path:
//
//   1. Ownership is resolved BEFORE anything is written, and the refusal is the resolver's.
//      A speaker posting somebody else's code must not reach the write at all: that is what
//      stops one speaker adding themselves to another's submission.
//   2. The edit policy is re-derived from the RECORD, so a frozen submission is refused
//      even when the request is otherwise perfect. The page is not the boundary.
//   3. The speaker is UPSERTED by email, so a co-author who already has a profile is linked
//      rather than duplicated, and the row is written only after that resolves.
//
// Everything it touches is mocked, since the subject is the sequence of calls.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError, ErrorIds, isAppError } from '@/constants/errorIds'

import { form, participant, submission } from './helpers/portal-fakes'

const mocks = vi.hoisted(() => ({
  requireSpeaker: vi.fn(),
  resolveOwnSubmission: vi.fn(),
  listForms: vi.fn(),
  upsertSpeakerByEmail: vi.fn(),
  addSubmissionParticipant: vi.fn(),
  removeSubmissionParticipant: vi.fn(),
  order: [] as string[],
}))

vi.mock('@/features/auth/wiring', () => ({ requireSpeaker: mocks.requireSpeaker }))
vi.mock('@/features/portal/event-scope', () => ({ portalEventId: () => 'recEvent1' }))
vi.mock('@/features/portal/resolve-submission', () => ({
  resolveOwnSubmission: mocks.resolveOwnSubmission,
}))
vi.mock('@/services/airtable/queries', () => ({ listForms: mocks.listForms }))
vi.mock('@/services/airtable/mutations-speakers', () => ({
  upsertSpeakerByEmail: mocks.upsertSpeakerByEmail,
}))
vi.mock('@/services/airtable/mutations-participants', () => ({
  addSubmissionParticipant: mocks.addSubmissionParticipant,
  removeSubmissionParticipant: mocks.removeSubmissionParticipant,
}))

const { addParticipant, removeParticipant } = await import('@/features/portal/roster-edit')

const ROLES = [
  { role: 'speaker' as const, enabled: true, min: 1, max: 1 },
  { role: 'co_speaker' as const, enabled: true, min: 0, max: 2 },
]

/** An open form, so `bodyEditPermission` lands on an editable mode. */
const OPEN_FORM = form({ roles: ROLES, closeDate: '2099-01-01T00:00:00.000Z' })

const CAST = [
  participant({ id: 'recPar1', speakerId: 'recSpeakerOwner', isPrimary: true, role: 'speaker' }),
  participant({
    id: 'recPar2',
    speakerId: 'recSpeakerCo',
    isPrimary: false,
    role: 'co_speaker',
    sortOrder: 2,
  }),
]

function addInput(overrides: Record<string, string> = {}) {
  return {
    code: 'SESS-1',
    email: 'marcus@example.com',
    firstName: 'Marcus',
    lastName: 'Okafor',
    role: 'co_speaker' as const,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.order.length = 0
  mocks.requireSpeaker.mockResolvedValue({ speakerId: 'recSpeakerOwner' })
  mocks.resolveOwnSubmission.mockImplementation(() => {
    mocks.order.push('resolve')
    return Promise.resolve(submission({ status: 'pending' }, CAST))
  })
  mocks.listForms.mockResolvedValue([OPEN_FORM])
  mocks.upsertSpeakerByEmail.mockImplementation(() => {
    mocks.order.push('upsert')
    return Promise.resolve({ id: 'recSpeakerNew', email: 'marcus@example.com' })
  })
  mocks.addSubmissionParticipant.mockImplementation(() => {
    mocks.order.push('write')
    return Promise.resolve('recParNew')
  })
  mocks.removeSubmissionParticipant.mockImplementation(() => {
    mocks.order.push('write')
    return Promise.resolve()
  })
})

describe('addParticipant', () => {
  it('resolves ownership, upserts the speaker, then writes the row, in that order', async () => {
    const result = await addParticipant(addInput())

    expect(result).toBe('marcus@example.com has been added to this submission.')
    expect(mocks.order).toEqual(['resolve', 'upsert', 'write'])
  })

  it('files the newcomer as a non-primary, after everyone already listed', async () => {
    await addParticipant(addInput())

    expect(mocks.addSubmissionParticipant.mock.calls[0][0]).toMatchObject({
      submissionId: 'recSub1',
      eventId: 'recEvent1',
      speakerId: 'recSpeakerNew',
      // Never primary from this path: two primaries make every "who do we email" read
      // ambiguous, and the primary is the submitter.
      draft: { speakerId: 'recSpeakerNew', role: 'co_speaker', isPrimary: false, sortOrder: 3 },
    })
  })

  it('writes nothing when the submission is not the caller’s', async () => {
    // The refusal is the resolver's, and it happens before the form is even read. This is
    // what stops a speaker adding themselves to somebody else's session by posting a code.
    mocks.resolveOwnSubmission.mockRejectedValue(
      new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'no such submission for this speaker', {}),
    )

    const error = await addParticipant(addInput()).catch((caught: unknown) => caught)

    expect(isAppError(error) && error.id).toBe(ErrorIds.DATA_RECORD_NOT_FOUND)
    expect(mocks.upsertSpeakerByEmail).not.toHaveBeenCalled()
    expect(mocks.addSubmissionParticipant).not.toHaveBeenCalled()
  })

  it('refuses once the form has closed, however the page rendered', async () => {
    // CFP-16 stays passing: a closed form yields `body_locked`, and the cast is part of the
    // body. Re-derived from the record here, not taken from the caller.
    mocks.listForms.mockResolvedValue([
      form({ roles: ROLES, closeDate: '2020-01-01T00:00:00.000Z' }),
    ])

    const error = await addParticipant(addInput()).catch((caught: unknown) => caught)

    expect(isAppError(error) && error.id).toBe(ErrorIds.SUB_ILLEGAL_TRANSITION)
    expect(mocks.addSubmissionParticipant).not.toHaveBeenCalled()
  })

  it('refuses a decided submission', async () => {
    mocks.resolveOwnSubmission.mockResolvedValue(submission({ status: 'accepted' }, CAST))

    const error = await addParticipant(addInput()).catch((caught: unknown) => caught)

    expect(isAppError(error) && error.id).toBe(ErrorIds.SUB_ILLEGAL_TRANSITION)
    expect(mocks.addSubmissionParticipant).not.toHaveBeenCalled()
  })

  it('reports a rule refusal as a message and writes nothing', async () => {
    const result = await addParticipant(addInput({ email: 'not-an-address' }))

    expect(result).toEqual({ failed: 'not-an-address is not a valid email address.' })
    expect(mocks.upsertSpeakerByEmail).not.toHaveBeenCalled()
  })

  it('catches a duplicate the email check could not see', async () => {
    // The roster is checked by email BEFORE the upsert and by resolved id AFTER it, because
    // two addresses can upsert to one Speakers row. Without the second check that row gets
    // two participant rows on one submission.
    mocks.upsertSpeakerByEmail.mockResolvedValue({
      id: 'recSpeakerCo',
      email: 'marcus@example.com',
    })

    const result = await addParticipant(addInput())

    expect(result).toEqual({ failed: 'That person is already on this submission.' })
    expect(mocks.addSubmissionParticipant).not.toHaveBeenCalled()
  })
})

describe('removeParticipant', () => {
  it('removes a co-speaker and names the speaker whose caches expire', async () => {
    const result = await removeParticipant({ code: 'SESS-1', participantId: 'recPar2' })

    expect(result).toBe('That person has been removed from this submission.')
    expect(mocks.removeSubmissionParticipant).toHaveBeenCalledWith({
      participantId: 'recPar2',
      submissionId: 'recSub1',
      eventId: 'recEvent1',
      // The person being removed, not the actor: it is their portal that changes.
      speakerId: 'recSpeakerCo',
    })
  })

  it('refuses the primary and writes nothing', async () => {
    const result = await removeParticipant({ code: 'SESS-1', participantId: 'recPar1' })

    expect(result).toEqual({
      failed:
        'The submitter cannot be removed from their own submission. Withdraw it instead if it should not go ahead.',
    })
    expect(mocks.removeSubmissionParticipant).not.toHaveBeenCalled()
  })

  it('writes nothing when the submission is not the caller’s', async () => {
    mocks.resolveOwnSubmission.mockRejectedValue(
      new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'no such submission for this speaker', {}),
    )

    await removeParticipant({ code: 'SESS-1', participantId: 'recPar2' }).catch(() => undefined)

    expect(mocks.removeSubmissionParticipant).not.toHaveBeenCalled()
  })

  it('refuses a participant id from another submission', async () => {
    const result = await removeParticipant({ code: 'SESS-1', participantId: 'recParElsewhere' })

    expect(result).toEqual({ failed: 'That person is not on this submission.' })
    expect(mocks.removeSubmissionParticipant).not.toHaveBeenCalled()
  })
})
