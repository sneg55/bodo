// The ORGANIZER's cast edit: what only this path does. The portal's own edit is covered by
// tests/portal-roster-edit.test.ts and the shared rules by tests/portal-roster-rules.test.ts,
// so nothing here re-asserts those. What is asserted is:
//
//   1. A REASSIGNMENT exists at all, and on the primary row it carries
//      `Submissions.submitter` with it. That is the whole defect: the primary cannot be
//      removed (required link, and it is who the decision email goes to), so a session
//      linked to the wrong duplicate speaker row was uncorrectable and got a duplicate
//      SESSION filed instead.
//   2. The organizer is NOT held to the speaker's rules: an accepted submission is editable
//      here where `roster-edit.ts` refuses one, and the form's role min/max is not applied.
//   3. Both ids are proved: `admin` on the event in the payload, AND that the record belongs
//      to that event. Neither alone is enough, because both arrive from the client.
//
// Everything it touches is mocked, since the subject is the sequence of calls.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError, ErrorIds, isAppError } from '@/constants/errorIds'

import { participant, submission } from './helpers/portal-fakes'

const mocks = vi.hoisted(() => ({
  requireEventRole: vi.fn(),
  getSubmission: vi.fn(),
  listSpeakers: vi.fn(),
  upsertSpeakerByEmail: vi.fn(),
  addSubmissionParticipant: vi.fn(),
  removeSubmissionParticipant: vi.fn(),
  reassignSubmissionParticipant: vi.fn(),
  order: [] as string[],
}))

vi.mock('@/features/auth/wiring', () => ({ requireEventRole: mocks.requireEventRole }))
vi.mock('@/services/airtable/queries', () => ({
  getSubmission: mocks.getSubmission,
  listSpeakers: mocks.listSpeakers,
}))
vi.mock('@/services/airtable/mutations-speakers', () => ({
  upsertSpeakerByEmail: mocks.upsertSpeakerByEmail,
}))
vi.mock('@/services/airtable/mutations-participants', () => ({
  addSubmissionParticipant: mocks.addSubmissionParticipant,
  removeSubmissionParticipant: mocks.removeSubmissionParticipant,
  reassignSubmissionParticipant: mocks.reassignSubmissionParticipant,
}))

const {
  addParticipantToSubmission,
  reassignParticipantOnSubmission,
  removeParticipantFromSubmission,
} = await import('@/features/submissions/roster-admin')

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

const TARGET = { eventId: 'recEvent1', submissionId: 'recSub1' }

function speakerRow(id: string, firstName: string, lastName: string, email: string) {
  return { id, firstName, lastName, email, links: {} }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.order.length = 0
  mocks.requireEventRole.mockImplementation(() => {
    mocks.order.push('authorize')
    return Promise.resolve({ userId: 'recUser1', role: 'admin' })
  })
  // Accepted, which the speaker's own path refuses outright.
  mocks.getSubmission.mockImplementation(() => {
    mocks.order.push('read')
    return Promise.resolve(submission({ status: 'accepted' }, CAST))
  })
  mocks.listSpeakers.mockResolvedValue([
    speakerRow('recSpeakerOwner', 'Priya', 'Raman', 'priya.raman@example.com'),
    speakerRow('recSpeakerCo', 'Marcus', 'Okafor', 'marcus@example.com'),
    speakerRow('recSpeakerRight', 'Priya', 'Raman', 'priya.speaker@sbek-test.example.com'),
  ])
  mocks.upsertSpeakerByEmail.mockImplementation(() => {
    mocks.order.push('upsert')
    return Promise.resolve({ id: 'recSpeakerNew', email: 'dana@example.com' })
  })
  mocks.addSubmissionParticipant.mockImplementation(() => {
    mocks.order.push('write')
    return Promise.resolve('recParNew')
  })
  mocks.removeSubmissionParticipant.mockImplementation(() => {
    mocks.order.push('write')
    return Promise.resolve()
  })
  mocks.reassignSubmissionParticipant.mockImplementation(() => {
    mocks.order.push('write')
    return Promise.resolve()
  })
})

describe('reassignParticipantOnSubmission', () => {
  it('repoints the PRIMARY row and says so, which is the case add plus remove cannot express', async () => {
    const result = await reassignParticipantOnSubmission({
      ...TARGET,
      participantId: 'recPar1',
      speakerId: 'recSpeakerRight',
    })

    expect(result).toBe('Priya Raman is now the submitter of this session.')
    expect(mocks.reassignSubmissionParticipant).toHaveBeenCalledWith({
      submissionId: 'recSub1',
      eventId: 'recEvent1',
      participantId: 'recPar1',
      // Both ids, because a reassignment is a removal for one person and an addition for
      // the other, and only `fromSpeakerId` expires the WRONG person's portal.
      fromSpeakerId: 'recSpeakerOwner',
      toSpeakerId: 'recSpeakerRight',
      // The flag that makes the DAL write `Submissions.submitter` as well. Without it the
      // decision email still goes to the person who was just taken off.
      isPrimary: true,
    })
  })

  it('repoints a co-speaker row without touching the submitter', async () => {
    const result = await reassignParticipantOnSubmission({
      ...TARGET,
      participantId: 'recPar2',
      speakerId: 'recSpeakerRight',
    })

    expect(result).toBe('Priya Raman is now on this session.')
    expect(mocks.reassignSubmissionParticipant.mock.calls[0][0]).toMatchObject({
      fromSpeakerId: 'recSpeakerCo',
      isPrimary: false,
    })
  })

  it('refuses a speaker who is not on the event, however the id was posted', async () => {
    // The id arrives as a string in a Server Action payload and nothing else checks it, so
    // without this a cross-event link is one crafted POST away.
    const result = await reassignParticipantOnSubmission({
      ...TARGET,
      participantId: 'recPar2',
      speakerId: 'recSpeakerElsewhere',
    })

    expect(result).toEqual({ failed: 'That speaker is not on this event.' })
    expect(mocks.reassignSubmissionParticipant).not.toHaveBeenCalled()
  })

  it('refuses a target who is already on the submission', async () => {
    const result = await reassignParticipantOnSubmission({
      ...TARGET,
      participantId: 'recPar1',
      speakerId: 'recSpeakerCo',
    })

    expect(result).toEqual({ failed: 'That person is already on this submission.' })
    expect(mocks.reassignSubmissionParticipant).not.toHaveBeenCalled()
  })

  it('refuses a participant id from another submission', async () => {
    const result = await reassignParticipantOnSubmission({
      ...TARGET,
      participantId: 'recParElsewhere',
      speakerId: 'recSpeakerRight',
    })

    expect(result).toEqual({ failed: 'That person is not on this session.' })
    expect(mocks.reassignSubmissionParticipant).not.toHaveBeenCalled()
  })

  it('authorizes before it reads, and writes nothing when the role check refuses', async () => {
    mocks.requireEventRole.mockRejectedValue(
      new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'admin required', {}),
    )

    const error = await reassignParticipantOnSubmission({
      ...TARGET,
      participantId: 'recPar1',
      speakerId: 'recSpeakerRight',
    }).catch((caught: unknown) => caught)

    expect(isAppError(error) && error.id).toBe(ErrorIds.AUTH_FORBIDDEN_ROLE)
    expect(mocks.getSubmission).not.toHaveBeenCalled()
    expect(mocks.reassignSubmissionParticipant).not.toHaveBeenCalled()
  })

  it('refuses a submission that belongs to a different event', async () => {
    // `requireEventRole` proves the role on the event in the PAYLOAD; this proves the
    // record is that event's. An organizer of one event must not be able to write another's
    // cast by pasting a submission id.
    mocks.getSubmission.mockResolvedValue(submission({ eventId: 'recEventOther' }, CAST))

    const error = await reassignParticipantOnSubmission({
      ...TARGET,
      participantId: 'recPar1',
      speakerId: 'recSpeakerRight',
    }).catch((caught: unknown) => caught)

    expect(isAppError(error) && error.id).toBe(ErrorIds.DATA_RECORD_NOT_FOUND)
    expect(mocks.reassignSubmissionParticipant).not.toHaveBeenCalled()
  })
})

/** `chairperson` is a role the form never offered: the organizer is not `assignableRoles`. */
function addInput(overrides: Record<string, string> = {}) {
  return {
    ...TARGET,
    email: 'dana@example.com',
    firstName: 'Dana',
    lastName: 'Kowalski',
    role: 'chairperson' as const,
    ...overrides,
  }
}

describe('addParticipantToSubmission', () => {
  it('authorizes, reads, upserts, then writes, on an ACCEPTED submission', async () => {
    // Accepted and past every speaker-side gate: the organizer is not subject to those.
    const result = await addParticipantToSubmission(addInput())

    expect(result).toBe('dana@example.com has been added to this session.')
    expect(mocks.order).toEqual(['authorize', 'read', 'upsert', 'write'])
    expect(mocks.addSubmissionParticipant.mock.calls[0][0]).toMatchObject({
      draft: { speakerId: 'recSpeakerNew', role: 'chairperson', isPrimary: false, sortOrder: 3 },
    })
  })

  it('never writes the typed name over an existing profile', async () => {
    // The two name boxes are how a NEW person gets a name. On an address that already
    // resolves to somebody they are a guess typed while naming a co-speaker, and this base
    // has four rows reading "Priya Raman": without `profileWrites: false` an organizer
    // adding one of them under a shortened name rewrites that person's CRM record across
    // every event they are on.
    await addParticipantToSubmission(addInput({ lastName: 'K' }))

    expect(mocks.upsertSpeakerByEmail.mock.calls[0][2]).toEqual({ profileWrites: false })
  })

  it('reports a bad address as a message and writes nothing', async () => {
    const result = await addParticipantToSubmission(addInput({ email: 'not-an-address' }))

    expect(result).toEqual({ failed: 'not-an-address is not a valid email address.' })
    expect(mocks.upsertSpeakerByEmail).not.toHaveBeenCalled()
  })

  it('catches a duplicate the email check could not see', async () => {
    // Two addresses can upsert to one Speakers row, so the roster is re-checked on the
    // RESOLVED id. Without it that row gets two participant rows on one submission.
    mocks.upsertSpeakerByEmail.mockResolvedValue({ id: 'recSpeakerCo', email: 'dana@example.com' })

    const result = await addParticipantToSubmission(addInput())

    expect(result).toEqual({ failed: 'That person is already on this submission.' })
    expect(mocks.addSubmissionParticipant).not.toHaveBeenCalled()
  })
})

describe('removeParticipantFromSubmission', () => {
  it('removes a co-speaker and names the speaker whose caches expire', async () => {
    const result = await removeParticipantFromSubmission({ ...TARGET, participantId: 'recPar2' })

    expect(result).toBe('That person has been removed from this session.')
    expect(mocks.removeSubmissionParticipant).toHaveBeenCalledWith({
      participantId: 'recPar2',
      submissionId: 'recSub1',
      eventId: 'recEvent1',
      speakerId: 'recSpeakerCo',
    })
  })

  it('still refuses the primary, which is why Change speaker exists', async () => {
    const result = await removeParticipantFromSubmission({ ...TARGET, participantId: 'recPar1' })

    expect(result).toEqual({
      failed:
        'The submitter cannot be removed from their own submission. Withdraw it instead if it should not go ahead.',
    })
    expect(mocks.removeSubmissionParticipant).not.toHaveBeenCalled()
  })
})
