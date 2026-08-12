// What a save-and-finish-later actually writes.
//
// This is the half of CFP-07 that localStorage could never do: bind the work to an
// address so it survives a device. The assertions that matter are therefore not "it
// resolves", they are the four properties that make the row safe to create from a PUBLIC,
// unauthenticated endpoint:
//
//   - it lands as `draft` with no `submittedAt`, so the organizer's queue is untouched;
//   - it carries a participant row, or `draftsOf` in reminders-wiring.ts drops the draft
//     and nobody is ever nudged about it;
//   - a second save UPDATES the first, so the button cannot be pumped for rows;
//   - the per-email cap is applied on create and NOT on update, so a draft is never
//     refused for the existence of itself.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { PreparedParticipant } from '@/features/submissions/prepare'
import { FIXTURE_EVENT } from '@/services/airtable/fixtures/event'
import type { Submission } from '@/types/domain'

import { CFP_FORM } from './helpers/cfp-form'

const mocks = vi.hoisted(() => ({
  createSubmission: vi.fn(),
  updateSubmission: vi.fn(),
  upsertSpeakerByEmail: vi.fn(),
  findSpeakerByEmail: vi.fn(),
  listSubmissions: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock('@/services/airtable/mutations', () => ({ createSubmission: mocks.createSubmission }))
vi.mock('@/services/airtable/mutations-content', () => ({
  updateSubmission: mocks.updateSubmission,
}))
vi.mock('@/services/airtable/mutations-speakers', () => ({
  upsertSpeakerByEmail: mocks.upsertSpeakerByEmail,
}))
vi.mock('@/services/airtable/queries', () => ({
  findSpeakerByEmail: mocks.findSpeakerByEmail,
  listSubmissions: mocks.listSubmissions,
}))
vi.mock('@/services/airtable/invalidate', () => ({ invalidate: mocks.invalidate }))

const { writeDraftSubmission } = await import('@/features/submissions/draft-write')

const EMAIL = 'ada@example.com'
const SPEAKER = { id: 'recSpeaker1', email: EMAIL }
/** Three, from `CFP_FORM.submissionLimit`, which is what the cap resolves to here. */
const EVENT = { ...FIXTURE_EVENT, id: 'recEvent1', submissionLimitPerUser: undefined }

const PREPARED = {
  title: 'Agents that ship',
  answers: { f_notes: 'Mornings' },
  columns: { title: 'Agents that ship', format: 'talk' },
  trackId: 'trkTalk',
  reviewRequired: true,
  unmapped: [],
}

function row(overrides: Partial<Submission>): Submission {
  return {
    id: 'recSub1',
    eventId: EVENT.id,
    code: 'SESS-1',
    title: 'Something',
    status: 'pending',
    source: 'form',
    reviewRequired: true,
    answers: {},
    formId: CFP_FORM.id,
    submitterId: SPEAKER.id,
    tagIds: [],
    ...overrides,
  } as Submission
}

/** What `draftCast` hands over: the submitter, primary, sorted first. */
// Annotated rather than inferred. Left to inference, `SOLO`'s element type carries a
// REQUIRED `lastName` and `role: 'speaker'`, so `[...SOLO, CO_SPEAKER]` in the co-speaker
// case fails to typecheck against a co-author who has neither. The cast these stand in for
// is `readonly PreparedParticipant[]`, so say that and let the two shapes be what they are.
const SOLO: readonly PreparedParticipant[] = [
  {
    draft: { email: EMAIL, firstName: 'Ada', lastName: 'Okafor', eventIds: [EVENT.id] },
    role: 'speaker',
    isPrimary: true,
    sortOrder: 1,
  },
]

const CO_SPEAKER: PreparedParticipant = {
  draft: { email: 'marcus@example.com', firstName: 'Marcus', eventIds: [EVENT.id] },
  role: 'co_speaker',
  isPrimary: false,
  sortOrder: 2,
}

function save(cast = SOLO) {
  return writeDraftSubmission({
    prepared: PREPARED,
    submitter: { email: EMAIL, firstName: 'Ada', lastName: 'Okafor' },
    cast,
    form: CFP_FORM,
    event: EVENT,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findSpeakerByEmail.mockResolvedValue(undefined)
  mocks.listSubmissions.mockResolvedValue([])
  mocks.upsertSpeakerByEmail.mockResolvedValue(SPEAKER)
  mocks.createSubmission.mockResolvedValue({ id: 'recNew1', code: 'SESS-9' })
  mocks.updateSubmission.mockResolvedValue(undefined)
})

describe('writeDraftSubmission, creating', () => {
  it('lands as a draft with no submit stamp', async () => {
    const outcome = await save()

    expect(outcome).toEqual({
      code: 'SESS-9',
      submissionId: 'recNew1',
      updated: false,
      submitterId: SPEAKER.id,
    })
    const written = mocks.createSubmission.mock.calls[0][0]
    expect(written.draft.status).toBe('draft')
    expect(written.draft.submittedAt).toBeUndefined()
    expect(written.draft.trackId).toBe('trkTalk')
    expect(written.draft.title).toBe('Agents that ship')
  })

  it('gives the draft a participant row, or nothing ever reminds the speaker', async () => {
    await save()

    const written = mocks.createSubmission.mock.calls[0][0]
    expect(written.participants).toEqual([
      { speakerId: SPEAKER.id, role: 'speaker', isPrimary: true, sortOrder: 1 },
    ])
  })

  it('carries the co-speakers, each upserted by email and none of them primary', async () => {
    // The draft used to record the submitter alone, because the portal roster was
    // read-only and a cast written here could never be corrected. ABS-11 made it editable,
    // so the reason is gone: a speaker who types a co-author into the wizard and saves
    // keeps them, and `upsertSpeakerByEmail` links an existing profile rather than
    // duplicating it.
    mocks.upsertSpeakerByEmail.mockImplementation((draft: { email: string }) =>
      Promise.resolve({ id: `rec-${draft.email}`, email: draft.email }),
    )

    await save([...SOLO, CO_SPEAKER])

    expect(mocks.upsertSpeakerByEmail).toHaveBeenCalledTimes(2)
    const written = mocks.createSubmission.mock.calls[0][0]
    expect(written.draft.submitterId).toBe(`rec-${EMAIL}`)
    expect(written.participants).toEqual([
      { speakerId: `rec-${EMAIL}`, role: 'speaker', isPrimary: true, sortOrder: 1 },
      { speakerId: 'rec-marcus@example.com', role: 'co_speaker', isPrimary: false, sortOrder: 2 },
    ])
  })

  it('expires the speaker list, so a new co-speaker reaches the admin directory', async () => {
    await save()

    expect(mocks.invalidate).toHaveBeenCalledWith('action', {
      own: [expect.stringContaining(EVENT.id)],
    })
  })
})

describe('writeDraftSubmission, saving twice', () => {
  it('updates the draft it already has rather than creating a second', async () => {
    mocks.findSpeakerByEmail.mockResolvedValue(SPEAKER)
    mocks.listSubmissions.mockResolvedValue([
      row({ id: 'recDraft1', code: 'SESS-4', status: 'draft' }),
    ])

    const outcome = await save()

    expect(outcome).toEqual({
      code: 'SESS-4',
      submissionId: 'recDraft1',
      updated: true,
      submitterId: SPEAKER.id,
    })
    expect(mocks.createSubmission).not.toHaveBeenCalled()
    expect(mocks.updateSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ submissionId: 'recDraft1', title: 'Agents that ship' }),
    )
  })

  it('never reopens a SUBMITTED row', async () => {
    // The line between "save my draft" and "edit my submission". The second is the
    // portal's, behind a session; a public endpoint that could rewrite a pending
    // submission would let anyone who knows an address change what was submitted.
    mocks.findSpeakerByEmail.mockResolvedValue(SPEAKER)
    mocks.listSubmissions.mockResolvedValue([row({ id: 'recPending1', status: 'pending' })])

    await save()

    expect(mocks.updateSubmission).not.toHaveBeenCalled()
    expect(mocks.createSubmission).toHaveBeenCalledTimes(1)
  })
})

describe('writeDraftSubmission, the cap', () => {
  it('refuses a create once the address is at the form limit', async () => {
    mocks.findSpeakerByEmail.mockResolvedValue(SPEAKER)
    mocks.listSubmissions.mockResolvedValue([
      row({ id: 'a', status: 'pending' }),
      row({ id: 'b', status: 'pending' }),
      row({ id: 'c', status: 'accepted' }),
    ])

    const error = await save().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).id).toBe(ErrorIds.SUB_LIMIT_REACHED)
    expect(mocks.createSubmission).not.toHaveBeenCalled()
  })

  it('does not refuse an update for the existence of the draft being updated', async () => {
    // Three rows, one of them the draft itself. Counting first and updating second would
    // make a draft unsaveable the moment it filled the last slot.
    mocks.findSpeakerByEmail.mockResolvedValue(SPEAKER)
    mocks.listSubmissions.mockResolvedValue([
      row({ id: 'a', status: 'pending' }),
      row({ id: 'b', status: 'pending' }),
      row({ id: 'recDraft1', code: 'SESS-4', status: 'draft' }),
    ])

    await expect(save()).resolves.toEqual({
      code: 'SESS-4',
      submissionId: 'recDraft1',
      updated: true,
      submitterId: SPEAKER.id,
    })
  })

  it('counts only this form, so another form of the same event is not in the way', async () => {
    mocks.findSpeakerByEmail.mockResolvedValue(SPEAKER)
    mocks.listSubmissions.mockResolvedValue([
      row({ id: 'a', formId: 'formOther', status: 'pending' }),
      row({ id: 'b', formId: 'formOther', status: 'pending' }),
      row({ id: 'c', formId: 'formOther', status: 'pending' }),
    ])

    await expect(save()).resolves.toEqual({
      code: 'SESS-9',
      submissionId: 'recNew1',
      updated: false,
      submitterId: SPEAKER.id,
    })
  })
})
