// Submitting a draft the speaker already saved, in place.
//
// The wizard now keeps its browser copy after Save & finish later, so pressing Submit on a
// resumed form is the ordinary case rather than an odd one. What has to hold is that it moves
// the row it already has:
//
//   - one abstract stays ONE record, however many times it was saved;
//   - the Submitted date is stamped, including on a `sessions` form that lands `accepted`
//     without ever passing through `pending`;
//   - a co-speaker typed in on the visit AFTER the draft was saved is attached;
//   - and nobody is ever REMOVED, because the roster belongs to the authenticated portal
//     editor once the row exists and a stale public tab must not be able to delete anyone.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PreparedParticipant, PreparedSubmission } from '@/features/submissions/prepare'
import type { Speaker, Submission } from '@/types/domain'

const mocks = vi.hoisted(() => ({
  updateSubmission: vi.fn(),
  setSubmissionStatus: vi.fn(),
  addSubmissionParticipant: vi.fn(),
  upsertSpeakerByEmail: vi.fn(),
  getSubmission: vi.fn(),
}))

vi.mock('@/services/airtable/mutations-content', () => ({
  updateSubmission: mocks.updateSubmission,
}))
vi.mock('@/services/airtable/mutations', () => ({
  setSubmissionStatus: mocks.setSubmissionStatus,
}))
vi.mock('@/services/airtable/mutations-participants', () => ({
  addSubmissionParticipant: mocks.addSubmissionParticipant,
}))
vi.mock('@/services/airtable/mutations-speakers', () => ({
  upsertSpeakerByEmail: mocks.upsertSpeakerByEmail,
}))
vi.mock('@/services/airtable/queries', () => ({ getSubmission: mocks.getSubmission }))

const { promoteDraftToSubmission } = await import('@/features/submissions/draft-promote')

const EMAIL = 'ada@example.com'
const EVENT_ID = 'recEvent1'

const DRAFT = {
  id: 'recDraft1',
  code: 'SESS-4',
  eventId: EVENT_ID,
  submitterId: 'recSpeakerAda',
  status: 'draft',
} as Submission

const ADA: PreparedParticipant = {
  draft: { email: EMAIL, firstName: 'Ada', lastName: 'Okafor', eventIds: [EVENT_ID] },
  role: 'speaker',
  isPrimary: true,
  sortOrder: 1,
}

const MARCUS: PreparedParticipant = {
  draft: { email: 'marcus@example.com', firstName: 'Marcus', eventIds: [EVENT_ID] },
  role: 'co_speaker',
  isPrimary: false,
  sortOrder: 2,
}

function prepared(overrides: Partial<PreparedSubmission> = {}): PreparedSubmission {
  return {
    status: 'pending',
    reviewRequired: true,
    createsReviewRows: true,
    title: 'Agents that ship',
    answers: { f_notes: 'Mornings' },
    columns: { title: 'Agents that ship', format: 'talk' },
    trackId: 'trkTalk',
    participants: [ADA],
    unmapped: [],
    ...overrides,
  }
}

function onTheRow(...emails: string[]) {
  return {
    ...DRAFT,
    participants: emails.map((email, index) => ({
      id: `recPart${index}`,
      submissionId: DRAFT.id,
      speakerId: `rec-${email}`,
      role: index === 0 ? 'speaker' : 'co_speaker',
      isPrimary: index === 0,
      sortOrder: index + 1,
      speaker: { id: `rec-${email}`, email } as Speaker,
    })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSubmission.mockResolvedValue(onTheRow(EMAIL))
  mocks.upsertSpeakerByEmail.mockImplementation((draft: { email: string }) =>
    Promise.resolve({ id: `rec-${draft.email}`, email: draft.email }),
  )
})

function promote(input: Partial<Parameters<typeof promoteDraftToSubmission>[0]> = {}) {
  return promoteDraftToSubmission({
    draft: DRAFT,
    prepared: prepared(),
    submitterEmail: EMAIL,
    ...input,
  })
}

describe('promoteDraftToSubmission', () => {
  it('moves the row the speaker already has rather than filing a second one', async () => {
    const outcome = await promote()

    expect(outcome).toEqual({ id: 'recDraft1', code: 'SESS-4', submitterId: 'recSpeakerAda' })
    expect(mocks.updateSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ submissionId: 'recDraft1', title: 'Agents that ship' }),
    )
  })

  it('stamps the submit date on the way into pending', async () => {
    await promote()

    expect(mocks.setSubmissionStatus).toHaveBeenCalledTimes(1)
    const change = mocks.setSubmissionStatus.mock.calls[0][0] as Record<string, unknown>
    expect(change.status).toBe('pending')
    expect(typeof change.submittedAt).toBe('string')
  })

  it('passes a sessions form THROUGH pending so its Submitted column is not left empty', async () => {
    // `statusFields` stamps the date only on the first move into `pending`, and a sessions
    // form lands `accepted`. The create path never had this problem because it writes
    // `submittedAt` inline on the new record.
    await promote({ prepared: prepared({ status: 'accepted', reviewRequired: false }) })

    const statuses = mocks.setSubmissionStatus.mock.calls.map(
      (call) => (call[0] as { status: string }).status,
    )
    expect(statuses).toEqual(['pending', 'accepted'])
  })

  it('attaches a co-speaker typed in after the draft was saved', async () => {
    await promote({ prepared: prepared({ participants: [ADA, MARCUS] }) })

    expect(mocks.addSubmissionParticipant).toHaveBeenCalledTimes(1)
    const added = mocks.addSubmissionParticipant.mock.calls[0][0] as {
      speakerId: string
      draft: { isPrimary: boolean; role: string }
    }
    expect(added.speakerId).toBe('rec-marcus@example.com')
    expect(added.draft.isPrimary).toBe(false)
    expect(added.draft.role).toBe('co_speaker')
  })

  it('adds nobody twice', async () => {
    mocks.getSubmission.mockResolvedValue(onTheRow(EMAIL, 'marcus@example.com'))

    await promote({ prepared: prepared({ participants: [ADA, MARCUS] }) })

    expect(mocks.addSubmissionParticipant).not.toHaveBeenCalled()
  })

  it('never removes anyone the wizard has dropped, because the portal owns the roster', async () => {
    // A stale wizard tab in one browser must not be able to delete a co-speaker somebody
    // curated while signed in, which is why this reconciles in one direction only.
    mocks.getSubmission.mockResolvedValue(onTheRow(EMAIL, 'curated@example.com'))

    await promote({ prepared: prepared({ participants: [ADA] }) })

    expect(mocks.addSubmissionParticipant).not.toHaveBeenCalled()
  })

  it('uses the speakers the caller already upserted rather than upserting them again', async () => {
    const speakers = new Map<string, Speaker>([
      ['marcus@example.com', { id: 'recMarcus', email: 'marcus@example.com' } as Speaker],
    ])

    await promote({ prepared: prepared({ participants: [ADA, MARCUS] }), speakers })

    expect(mocks.upsertSpeakerByEmail).not.toHaveBeenCalled()
    const added = mocks.addSubmissionParticipant.mock.calls[0][0] as { speakerId: string }
    expect(added.speakerId).toBe('recMarcus')
  })
})
