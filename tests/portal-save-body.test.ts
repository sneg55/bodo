// The body save as a sequence, which is the half `prepareBodyEdit` cannot pin.
//
// Three orderings decide whether this is correct, and none of them is visible by reading
// the happy path:
//
//   1. Ownership is resolved BEFORE anything is written, and the refusal is the resolver's.
//      A speaker posting somebody else's code must not reach the write at all.
//   2. The edit policy is re-derived from the RECORD, so a frozen submission is refused
//      even when the request is otherwise perfect. The page is not the boundary.
//   3. The admin alert is enqueued after the write and only when the edit was an update to
//      something already submitted, because a draft that has never been submitted is not
//      news to an organizer.
//
// Everything it touches is mocked, since the subject here is the sequence of calls.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorIds, isAppError } from '@/constants/errorIds'
import { idempotencyKeys } from '@/features/comms/triggers'
import type { SubmissionWithParticipants } from '@/types/domain'
import type { Form } from '@/types/forms'

import { field, form, submission } from './helpers/portal-fakes'

const mocks = vi.hoisted(() => ({
  requireSpeaker: vi.fn(),
  resolveOwnSubmission: vi.fn(),
  listForms: vi.fn(),
  getEvent: vi.fn(),
  updateSubmission: vi.fn(),
  enqueueOutbox: vi.fn(),
  /** `EmailTemplates[key=custom-admin-update]`. No row, so the built-in body sends. */
  findEmailTemplate: vi.fn(() => Promise.resolve(undefined)),
  /** Call order across the mocks, which is the actual subject of this file. */
  order: [] as string[],
}))

vi.mock('@/features/auth/wiring', () => ({ requireSpeaker: mocks.requireSpeaker }))
vi.mock('@/features/portal/event-scope', () => ({ portalEventId: () => 'recEvent1' }))
vi.mock('@/features/portal/resolve-submission', () => ({
  resolveOwnSubmission: mocks.resolveOwnSubmission,
}))
vi.mock('@/services/airtable/queries', () => ({
  listForms: mocks.listForms,
  getEvent: mocks.getEvent,
}))
vi.mock('@/services/airtable/mutations-content', () => ({
  updateSubmission: mocks.updateSubmission,
}))
vi.mock('@/features/submissions/decision-outbox', () => ({ enqueueOutbox: mocks.enqueueOutbox }))
vi.mock('@/services/airtable/reads-comms', () => ({
  findEmailTemplate: mocks.findEmailTemplate,
}))
vi.mock('@/utils/env', () => ({ appUrl: () => 'https://bodo.test' }))

const { saveSubmissionBody } = await import('@/features/portal/save-body')

const CFP: Form = form({
  closeDate: '2126-09-15T23:59:00.000Z',
  adminAlertOnUpdate: ['organizer@example.com'],
  fields: [
    field({ id: 'fld_title', label: 'Title', registryKey: 'title' }),
    field({ id: 'fld_notes', label: 'Anything else' }),
  ],
})

const ANSWERS = { fld_title: 'Evaluating agents', fld_notes: 'Prefer the morning' }

function ownRecord(overrides: Partial<SubmissionWithParticipants> = {}) {
  return submission({ id: 'recSub1', code: 'SESS-1', formId: CFP.id, ...overrides })
}

async function refusalId(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run()
    return undefined
  } catch (error) {
    return isAppError(error) ? error.id : undefined
  }
}

beforeEach(() => {
  mocks.order.length = 0
  for (const fn of [
    mocks.requireSpeaker,
    mocks.resolveOwnSubmission,
    mocks.listForms,
    mocks.getEvent,
    mocks.updateSubmission,
    mocks.enqueueOutbox,
  ]) {
    fn.mockReset()
  }

  mocks.requireSpeaker.mockResolvedValue({ speakerId: 'recSpeakerOwner' })
  mocks.listForms.mockResolvedValue([CFP])
  mocks.getEvent.mockResolvedValue({ id: 'recEvent1', name: 'AI Engineer Sandbox', slug: 'aies' })
  mocks.resolveOwnSubmission.mockImplementation(() => {
    mocks.order.push('resolve')
    return Promise.resolve(ownRecord({ status: 'draft' }))
  })
  mocks.updateSubmission.mockImplementation(() => {
    mocks.order.push('write')
    return Promise.resolve()
  })
  mocks.enqueueOutbox.mockImplementation(() => {
    mocks.order.push('enqueue')
    return Promise.resolve(1)
  })
})

describe('saveSubmissionBody on a draft', () => {
  it('saves, and tells the speaker so', async () => {
    const result = await saveSubmissionBody({ code: 'SESS-1', answers: ANSWERS })

    expect(result).toBe('Your changes have been saved.')
    expect(mocks.updateSubmission).toHaveBeenCalledTimes(1)
    expect(mocks.updateSubmission.mock.calls.at(0)?.[0]).toMatchObject({
      submissionId: 'recSub1',
      eventId: 'recEvent1',
      title: 'Evaluating agents',
      answers: { fld_notes: 'Prefer the morning' },
    })
  })

  it('resolves the caller and the record before it writes anything', async () => {
    await saveSubmissionBody({ code: 'SESS-1', answers: ANSWERS })

    expect(mocks.order).toEqual(['resolve', 'write'])
    // No `eventId`. `resolveOwnSubmission` resolves the speaker's OWN event scope now, so
    // the caller no longer passes one: passing `portalEventId()` here is what made editing a
    // submission filed to any other conference fail as not-found on a record that existed
    // and belonged to the person asking.
    expect(mocks.resolveOwnSubmission.mock.calls.at(0)?.[0]).toMatchObject({
      speakerId: 'recSpeakerOwner',
      code: 'SESS-1',
    })
    expect(mocks.resolveOwnSubmission.mock.calls.at(0)?.[0]).not.toHaveProperty('eventId')
  })

  it('alerts no admin, because a draft nobody has submitted is not news', async () => {
    await saveSubmissionBody({ code: 'SESS-1', answers: ANSWERS })

    expect(mocks.enqueueOutbox).not.toHaveBeenCalled()
  })

  it('returns the field problems instead of writing a half-valid answer set', async () => {
    const required = form({
      ...CFP,
      fields: [field({ id: 'fld_title', label: 'Title', required: true, registryKey: 'title' })],
    })
    mocks.listForms.mockResolvedValue([required])

    const result = await saveSubmissionBody({ code: 'SESS-1', answers: { fld_title: '' } })

    expect(result).toEqual({ failed: 'Title is required.' })
    expect(mocks.updateSubmission).not.toHaveBeenCalled()
  })
})

describe('saveSubmissionBody after submission', () => {
  beforeEach(() => {
    mocks.resolveOwnSubmission.mockImplementation(() => {
      mocks.order.push('resolve')
      return Promise.resolve(ownRecord({ status: 'pending' }))
    })
  })

  it('saves, and enqueues exactly one admin-update row', async () => {
    await saveSubmissionBody({ code: 'SESS-1', answers: ANSWERS })

    const rows = mocks.enqueueOutbox.mock.calls.at(0)?.[0] as readonly { kind: string }[]
    expect(rows).toHaveLength(1)
    expect(rows.at(0)?.kind).toBe('submission.admin_update')
  })

  it('enqueues after the write, so no organizer is told about an edit that did not land', async () => {
    await saveSubmissionBody({ code: 'SESS-1', answers: ANSWERS })

    expect(mocks.order).toEqual(['resolve', 'write', 'enqueue'])
  })

  it('keys the row on the submission and the instant of the save', async () => {
    await saveSubmissionBody({ code: 'SESS-1', answers: ANSWERS })

    const rows = mocks.enqueueOutbox.mock.calls.at(0)?.[0] as readonly {
      idempotencyKey: string
      sendAt: string
    }[]
    const key = rows.at(0)
    expect(key?.idempotencyKey.startsWith(idempotencyKeys.adminUpdate('recSub1', key.sendAt))).toBe(
      true,
    )
  })

  it('sends nothing inline: the outbox row is the whole output', async () => {
    await saveSubmissionBody({ code: 'SESS-1', answers: ANSWERS })

    // 5.3 has one lifecycle. If this file ever needs an email mock, that rule has broken.
    expect(mocks.enqueueOutbox).toHaveBeenCalledTimes(1)
  })

  it('enqueues nothing when the form names no alert recipients', async () => {
    mocks.listForms.mockResolvedValue([form({ ...CFP, adminAlertOnUpdate: [] })])

    await saveSubmissionBody({ code: 'SESS-1', answers: ANSWERS })

    expect(mocks.updateSubmission).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueOutbox.mock.calls.at(0)?.[0]).toEqual([])
  })
})

describe('saveSubmissionBody refusals', () => {
  it('refuses an accepted submission server-side, with nothing written', async () => {
    mocks.resolveOwnSubmission.mockResolvedValue(ownRecord({ status: 'accepted' }))

    const id = await refusalId(
      async () => await saveSubmissionBody({ code: 'SESS-1', answers: ANSWERS }),
    )

    expect(id).toBe(ErrorIds.SUB_BODY_LOCKED)
    expect(mocks.updateSubmission).not.toHaveBeenCalled()
    expect(mocks.enqueueOutbox).not.toHaveBeenCalled()
  })

  it('refuses once the form has closed, even for a draft', async () => {
    mocks.listForms.mockResolvedValue([form({ ...CFP, closeDate: '2020-01-01T00:00:00.000Z' })])

    expect(
      await refusalId(async () => await saveSubmissionBody({ code: 'SESS-1', answers: ANSWERS })),
    ).toBe(ErrorIds.SUB_BODY_LOCKED)
    expect(mocks.updateSubmission).not.toHaveBeenCalled()
  })

  it('never reaches the write when the record belongs to somebody else', async () => {
    mocks.resolveOwnSubmission.mockRejectedValue(
      new Error('resolveOwnSubmission refuses a code the speaker does not own'),
    )

    await expect(saveSubmissionBody({ code: 'SESS-9', answers: ANSWERS })).rejects.toThrow()
    expect(mocks.updateSubmission).not.toHaveBeenCalled()
  })
})
