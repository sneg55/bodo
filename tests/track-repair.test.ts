// Repairing a submission whose stored track predates the CFP-06/CFP-15 precedence fix.
// `tests/submissions-track-answer.test.ts` already covers `staleTrackId` itself; this
// covers `previewTrackFix`/`applyTrackFix`, which run the same pipeline `prepareSubmission`
// does over a submission's STORED answers rather than a fresh payload.
//
// `repairSubmissionTrackAction`, the organizer-facing control's write, lives in
// `track-repair-action.ts` (own file, own test) precisely so this module stays free of
// `requireEventRole` - see that file's header for why the split exists at all.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FormField } from '@/types/forms'

import { form, submission } from './helpers/portal-fakes'

const mocks = vi.hoisted(() => ({
  updateSubmission: vi.fn(),
}))

vi.mock('@/services/airtable/mutations-content', () => ({
  updateSubmission: mocks.updateSubmission,
}))

const { previewTrackFix, applyTrackFix } = await import('@/features/submissions/track-repair')

const INFRA = 'recPlatformInfra'
const AGENTS = 'recAgentsTrack'

const TRACK: FormField = {
  id: 'fld_track',
  type: 'select',
  label: 'Track',
  required: false,
  registryKey: 'track',
  options: [
    { value: INFRA, label: 'Platform & Infra' },
    { value: AGENTS, label: 'Agents' },
  ],
}

const CFP_FORM = form({ fields: [TRACK], routing: { rules: [] } })

beforeEach(() => {
  mocks.updateSubmission.mockReset()
  mocks.updateSubmission.mockResolvedValue(undefined)
})

describe('previewTrackFix', () => {
  it('finds the correction when the stored track disagrees with the submitted answer', () => {
    const row = submission({ trackId: AGENTS, answers: { fld_track: INFRA } })
    expect(previewTrackFix(row, CFP_FORM)).toBe(INFRA)
  })

  it('finds nothing once the stored track already matches the answer', () => {
    const row = submission({ trackId: INFRA, answers: { fld_track: INFRA } })
    expect(previewTrackFix(row, CFP_FORM)).toBeUndefined()
  })

  it('finds nothing when there is no direct Track answer to trust, however it disagrees with routing', () => {
    // No `fld_track` answer at all: whatever is stored might be an organizer's own
    // decision (a routing rule, a reassignment made some other way), and this function
    // cannot tell that apart from staleness, so it leaves it alone.
    const row = submission({ trackId: AGENTS, answers: {} })
    expect(previewTrackFix(row, CFP_FORM)).toBeUndefined()
  })
})

describe('applyTrackFix', () => {
  it('writes the corrected track, echoing every other column back unchanged', async () => {
    const row = submission({
      trackId: AGENTS,
      answers: { fld_track: INFRA },
      title: 'Taming 40-Minute CI: Incremental Builds at Monorepo Scale',
      format: 'talk',
      tagIds: ['recTagLive'],
    })

    const result = await applyTrackFix('recEvent1', row, CFP_FORM)

    expect(result).toBe(INFRA)
    expect(mocks.updateSubmission).toHaveBeenCalledExactlyOnceWith({
      submissionId: row.id,
      eventId: 'recEvent1',
      title: row.title,
      answers: row.answers,
      format: row.format,
      level: row.level,
      language: row.language,
      ceuCredits: row.ceuCredits,
      trackId: INFRA,
      tagIds: row.tagIds,
    })
  })

  it('writes nothing when there is nothing to correct', async () => {
    const row = submission({ trackId: INFRA, answers: { fld_track: INFRA } })

    const result = await applyTrackFix('recEvent1', row, CFP_FORM)

    expect(result).toBeUndefined()
    expect(mocks.updateSubmission).not.toHaveBeenCalled()
  })
})
