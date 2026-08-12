// WHO a saved draft is filed under, and why this path needed it more than the submit did.
//
// `saveCfpDraft` hands the browser a signed draft claim for whatever `writeDraftSubmission`
// returns as `submitterId`, on the `create` branch, and the whole safety argument for doing
// that is "the row this request just made for the address it was given" (see
// `@/features/auth/submitter-identity`). Filing under whichever participant carried
// `isPrimary` broke that argument: a payload with a throwaway account address and an EXISTING
// person flagged primary took the `create` branch, filed under that person, and minted signed
// proof of THEIR record. A second request presenting that claim binds to them, and binding
// turns `profileWrites` on, which is the CFP-02 impersonation finding back again through the
// new mechanism. The last test here walks that sequence.
//
// The mock harness mirrors tests/submissions-draft-write.test.ts, which owns the create,
// update and cap properties and is at its line budget.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { submitterBinding } from '@/features/auth/submitter-identity'
import type { PreparedParticipant } from '@/features/submissions/prepare'
import { FIXTURE_EVENT } from '@/services/airtable/fixtures/event'

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

const EVENT = { ...FIXTURE_EVENT, id: 'recEvent1', submissionLimitPerUser: undefined }
/** A throwaway address nobody has used, which is the only branch an anonymous POST reaches. */
const SUBMITTER = 'fresh@example.com'
/** Somebody who already has a Speakers row and never touched this browser. */
const VICTIM_EMAIL = 'grace@example.com'

const PREPARED = {
  title: 'Agents that ship',
  answers: {},
  columns: { title: 'Agents that ship' },
  reviewRequired: true,
  unmapped: [],
}

const VICTIM: PreparedParticipant = {
  draft: { email: VICTIM_EMAIL, firstName: 'Grace', eventIds: [EVENT.id] },
  role: 'speaker',
  isPrimary: true,
  sortOrder: 1,
}

const SUBMITTER_ROW: PreparedParticipant = {
  draft: { email: SUBMITTER, firstName: 'Ada', eventIds: [EVENT.id] },
  role: 'co_speaker',
  isPrimary: false,
  sortOrder: 2,
}

function save(cast: readonly PreparedParticipant[]) {
  return writeDraftSubmission({
    prepared: PREPARED,
    submitter: { email: SUBMITTER, firstName: 'Ada', lastName: 'Okafor' },
    cast,
    form: CFP_FORM,
    event: EVENT,
  })
}

function optionsFor(email: string): { profileWrites?: boolean } | undefined {
  const call = mocks.upsertSpeakerByEmail.mock.calls.find(
    (args) => (args.at(0) as { email: string }).email === email,
  )
  return call?.at(2) as { profileWrites?: boolean } | undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findSpeakerByEmail.mockResolvedValue(undefined)
  mocks.listSubmissions.mockResolvedValue([])
  mocks.createSubmission.mockResolvedValue({ id: 'recNew1', code: 'SESS-9' })
  mocks.upsertSpeakerByEmail.mockImplementation((draft: { email: string }) =>
    Promise.resolve({ id: `rec-${draft.email}`, email: draft.email }),
  )
})

describe('writeDraftSubmission, who the row is filed under', () => {
  it('files under the proven address when the cast flags somebody else primary', async () => {
    const outcome = await save([SUBMITTER_ROW, VICTIM])

    expect(outcome.submitterId).toBe(`rec-${SUBMITTER}`)
    const written = mocks.createSubmission.mock.calls[0][0] as {
      draft: { submitterId: string }
      participants: readonly unknown[]
    }
    expect(written.draft.submitterId).toBe(`rec-${SUBMITTER}`)
    // The roster still says what the payload said. Being NAMED on a draft is open, and has
    // to be; being the row it is FILED under is not.
    expect(written.participants).toContainEqual({
      speakerId: `rec-${VICTIM_EMAIL}`,
      role: 'speaker',
      isPrimary: true,
      sortOrder: 1,
    })
  })

  it('creates the submitter row rather than borrowing one when the cast is all strangers', async () => {
    const outcome = await save([VICTIM])

    expect(outcome.submitterId).toBe(`rec-${SUBMITTER}`)
    expect(optionsFor(SUBMITTER)?.profileWrites).toBe(true)
    expect(optionsFor(VICTIM_EMAIL)?.profileWrites).toBe(false)
  })

  it('so the draft claim it mints can only ever name the submitter own record', async () => {
    // The escalation, walked in order. `saveCfpDraft` grants a claim for `outcome.submitterId`
    // when the binding was `create`, so what that value is decides what the claim unlocks.
    const outcome = await save([SUBMITTER_ROW, VICTIM])

    // Request two, presenting the claim under the victim's address. `existingSpeakerId` is
    // the victim's row; the claim names the submitter's, so the addresses do not match and
    // the binding is still `unproven`. With the old value the two matched and this returned
    // `bind`, which is what turns `profileWrites` on for the victim's record.
    expect(
      submitterBinding({
        existingSpeakerId: `rec-${VICTIM_EMAIL}`,
        subject: undefined,
        claimedSpeakerId: outcome.submitterId,
      }),
    ).toEqual({ kind: 'unproven', speakerId: `rec-${VICTIM_EMAIL}` })
  })
})
