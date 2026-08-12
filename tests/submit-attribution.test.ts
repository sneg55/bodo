// WHO a public submission is filed under, which is `Submissions.submitter`.
//
// The impersonation guard in `@/features/auth/submitter-identity` is checked against ONE
// address, the Account step's, and `submitterId` used to be read off a different field
// entirely: whichever participant the payload flagged `isPrimary`. So a payload carrying a
// FRESH account address took the `create` branch, was allowed, and still filed the row under
// an existing person who had proved nothing. That person's per-form cap was spent, their
// address got the confirmation email, and the organizer's Abstracts table read "submitted by"
// them. On the draft path it was worse: `saveCfpDraft` grants a draft claim for whatever row
// it filed under, so the same payload minted signed proof of somebody else's record.
//
// The two questions are now separate and both are asserted here: who PRESENTS is still the
// payload's to say, and naming a co-presenter still works; who a submission is FILED under is
// the proven address and nothing else.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SubmitPayload } from '@/features/submissions/payload'
import { FIXTURE_EVENT } from '@/services/airtable/fixtures/event'

import { CFP_FORM, cfpPayload, soloSpeaker } from './helpers/cfp-form'

const mocks = vi.hoisted(() => ({
  resolvePublicForm: vi.fn(),
  submitterContext: vi.fn(),
  readDraftClaim: vi.fn(),
  sessionSubject: vi.fn(),
  hasSession: vi.fn(),
  createSubmission: vi.fn(),
  setSubmissionStatus: vi.fn(),
  updateSubmission: vi.fn(),
  addSubmissionParticipant: vi.fn(),
  getSubmission: vi.fn(),
  upsertSpeakerByEmail: vi.fn(),
  invalidate: vi.fn(),
  sendSubmissionConfirmation: vi.fn(),
  alertAdminsOnNewSubmission: vi.fn(),
}))

vi.mock('@/features/submissions/public-form', () => ({
  resolvePublicForm: mocks.resolvePublicForm,
}))
vi.mock('@/features/submissions/submitter-context', () => ({
  submitterContext: mocks.submitterContext,
  readDraftClaim: mocks.readDraftClaim,
}))
vi.mock('@/features/auth/wiring', () => ({
  sessionSubject: mocks.sessionSubject,
  hasSession: mocks.hasSession,
}))
vi.mock('@/features/submissions/confirmation-email', () => ({
  sendSubmissionConfirmation: mocks.sendSubmissionConfirmation,
}))
vi.mock('@/features/submissions/new-submission-alert', () => ({
  alertAdminsOnNewSubmission: mocks.alertAdminsOnNewSubmission,
}))
vi.mock('@/services/airtable/mutations', () => ({
  createSubmission: mocks.createSubmission,
  setSubmissionStatus: mocks.setSubmissionStatus,
}))
vi.mock('@/services/airtable/mutations-content', () => ({
  updateSubmission: mocks.updateSubmission,
}))
vi.mock('@/services/airtable/mutations-participants', () => ({
  addSubmissionParticipant: mocks.addSubmissionParticipant,
}))
vi.mock('@/services/airtable/mutations-speakers', () => ({
  upsertSpeakerByEmail: mocks.upsertSpeakerByEmail,
}))
vi.mock('@/services/airtable/queries', () => ({ getSubmission: mocks.getSubmission }))
vi.mock('@/services/airtable/invalidate', () => ({ invalidate: mocks.invalidate }))

const { submitCfp } = await import('@/features/submissions/actions')

const EVENT = { ...FIXTURE_EVENT, id: 'ev1', submissionLimitPerUser: undefined }

/** The submitter the Account step proves, and the row `upsertSpeakerByEmail` gives them. */
const SUBMITTER = 'ada@example.com'
/** Somebody who ALREADY has a Speakers row and never touched this browser. */
const VICTIM = 'grace@example.com'

function speakerRow(email: string): string {
  return `rec-${email}`
}

function submit(payload: Partial<SubmitPayload> = {}) {
  return submitCfp({
    eventSlug: 'ev',
    formPublicId: CFP_FORM.publicId,
    payload: cfpPayload(payload),
  })
}

/** The record `createSubmission` was actually asked to write. */
function written(): {
  draft: { submitterId: string }
  participants: readonly { speakerId: string; isPrimary: boolean }[]
} {
  return mocks.createSubmission.mock.calls[0][0] as ReturnType<typeof written>
}

function profileWritesFor(email: string): boolean | undefined {
  const call = mocks.upsertSpeakerByEmail.mock.calls.find(
    (args) => (args.at(0) as { email: string }).email === email,
  )
  return (call?.at(2) as { profileWrites?: boolean } | undefined)?.profileWrites
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolvePublicForm.mockResolvedValue({
    open: true,
    form: CFP_FORM,
    event: EVENT,
    publicForm: {},
  })
  // The `create` branch: nothing under the submitter's address, which is what a first-time
  // submitter looks like and the only branch an anonymous POST can reach.
  mocks.submitterContext.mockResolvedValue({ count: 0 })
  mocks.readDraftClaim.mockResolvedValue(undefined)
  mocks.sessionSubject.mockResolvedValue(undefined)
  mocks.hasSession.mockResolvedValue(false)
  mocks.upsertSpeakerByEmail.mockImplementation((draft: { email: string }) =>
    Promise.resolve({ id: speakerRow(draft.email), email: draft.email, lastName: 'Row' }),
  )
  mocks.createSubmission.mockResolvedValue({ id: 'recSub9', code: 'SESS-9' })
})

describe('submitCfp, the ordinary casts', () => {
  it('files a solo submission under the address the Account step proved', async () => {
    const result = await submit()

    expect(result.ok).toBe(true)
    expect(written().draft.submitterId).toBe(speakerRow(SUBMITTER))
    expect(written().participants).toEqual([
      { speakerId: speakerRow(SUBMITTER), role: 'speaker', isPrimary: true, sortOrder: 1 },
    ])
  })

  it('accepts a co-presenter beside the proven submitter and still files under the submitter', async () => {
    // The case a refusal-shaped fix would have broken. Naming somebody else on a submission
    // is what a call for papers is for; it just is not a claim to BE them, which is why the
    // co-presenter's profile is not writable here either.
    const result = await submit({
      participants: [
        soloSpeaker(),
        soloSpeaker({
          key: 'p2',
          role: 'co_speaker',
          isPrimary: false,
          email: 'marcus@example.com',
          firstName: 'Marcus',
          lastName: 'Bell',
        }),
      ],
    })

    expect(result.ok).toBe(true)
    expect(written().draft.submitterId).toBe(speakerRow(SUBMITTER))
    expect(written().participants).toHaveLength(2)
    expect(profileWritesFor(SUBMITTER)).toBe(true)
    expect(profileWritesFor('marcus@example.com')).toBe(false)
  })
})

describe('submitCfp, a payload that flags somebody else primary', () => {
  it('files under the submitter, not under the person flagged primary', async () => {
    // THE HOLE. `submitterBinding` sees only `ada@example.com`, which nobody has used, so it
    // returns `create` and the submit is allowed. Before the fix `submitterId` came off the
    // participant carrying `isPrimary` and this row landed on Grace's record.
    const result = await submit({
      participants: [
        soloSpeaker({ role: 'co_speaker', isPrimary: false }),
        soloSpeaker({
          key: 'p2',
          role: 'speaker',
          isPrimary: true,
          email: VICTIM,
          firstName: 'Grace',
          lastName: 'Hopper',
        }),
      ],
    })

    expect(result.ok).toBe(true)
    expect(written().draft.submitterId).toBe(speakerRow(SUBMITTER))
    expect(written().draft.submitterId).not.toBe(speakerRow(VICTIM))
  })

  it('keeps the roster the payload asked for, because who PRESENTS is a different question', async () => {
    await submit({
      participants: [
        soloSpeaker({ role: 'co_speaker', isPrimary: false }),
        soloSpeaker({
          key: 'p2',
          role: 'speaker',
          isPrimary: true,
          email: VICTIM,
          firstName: 'Grace',
          lastName: 'Hopper',
        }),
      ],
    })

    // Grace is on the submission and flagged primary, exactly as the payload said, and her
    // own profile is still not writable from here. Being NAMED was always open: the portal
    // shows a speaker every session they are on the roster of (`own-submissions.ts`), and
    // that is the same whether the flag is set or not. What is closed is the row being HERS.
    expect(written().participants).toContainEqual({
      speakerId: speakerRow(VICTIM),
      role: 'speaker',
      isPrimary: true,
      sortOrder: 2,
    })
    expect(profileWritesFor(VICTIM)).toBe(false)
  })

  it('addresses the confirmation email to the submitter and never to the flagged person', async () => {
    // A public endpoint that mails an arbitrary existing address on demand, with a subject
    // line the sender chose, is a primitive `saveCfpDraft` deliberately declines to offer.
    // Reading the recipient off `isPrimary` handed the submit path exactly that.
    await submit({
      participants: [
        soloSpeaker({ role: 'co_speaker', isPrimary: false }),
        soloSpeaker({
          key: 'p2',
          role: 'speaker',
          isPrimary: true,
          email: VICTIM,
          firstName: 'Grace',
          lastName: 'Hopper',
        }),
      ],
    })

    const confirmation = mocks.sendSubmissionConfirmation.mock.calls[0][0] as {
      submitter: { id: string }
    }
    expect(confirmation.submitter.id).toBe(speakerRow(SUBMITTER))
    const alert = mocks.alertAdminsOnNewSubmission.mock.calls[0][0] as {
      submitter: { id: string }
    }
    expect(alert.submitter.id).toBe(speakerRow(SUBMITTER))
  })

  it('files under the submitter even when the cast names nobody but the flagged person', async () => {
    // The narrowest version of the attack: one participant, an existing person, flagged
    // primary, and the account address is a throwaway. The submitter is not on the cast at
    // all, so their row is created here rather than borrowed from somebody who is.
    const result = await submit({
      participants: [
        soloSpeaker({
          key: 'p2',
          role: 'speaker',
          isPrimary: true,
          email: VICTIM,
          firstName: 'Grace',
          lastName: 'Hopper',
        }),
      ],
    })

    expect(result.ok).toBe(true)
    expect(written().draft.submitterId).toBe(speakerRow(SUBMITTER))
    expect(profileWritesFor(SUBMITTER)).toBe(true)
    expect(profileWritesFor(VICTIM)).toBe(false)
  })

  it('refuses outright when the ACCOUNT address is the one that already exists', async () => {
    // Unchanged, and the reason this fix is not a replacement for the binding check: the
    // guard still refuses before anything is written when the proven address is somebody's.
    mocks.submitterContext.mockResolvedValue({ existing: { id: 'recGrace' }, count: 0 })

    const result = await submit({ email: VICTIM, participants: [soloSpeaker({ email: VICTIM })] })

    expect(result.ok).toBe(false)
    expect(mocks.createSubmission).not.toHaveBeenCalled()
    expect(mocks.upsertSpeakerByEmail).not.toHaveBeenCalled()
  })
})
