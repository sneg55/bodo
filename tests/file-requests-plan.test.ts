// What a file request assignment run would write, and never a second row for one document.

import { describe, expect, it } from 'vitest'
import { planRequestAssignments, requestAssignmentKey } from '@/features/file-requests/plan'
import type { SpeakerScope } from '@/features/tasks/scope'
import {
  mapFileRequestAssignment,
  mapFileRequestAssignmentIfIntact,
} from '@/services/airtable/mapping-requests'

import { CO_SPEAKER, fileRequest, OWNER, requestAssignment, speaker } from './helpers/portal-fakes'

const owner: SpeakerScope = { speaker: speaker({ id: OWNER }), submissionIds: ['recSub1'] }
const co: SpeakerScope = {
  speaker: speaker({ id: CO_SPEAKER, firstName: 'Bo', lastName: 'Lin' }),
  submissionIds: ['recSub1', 'recSub2'],
}

const release = fileRequest({
  id: 'recReqRelease',
  entityType: 'contact',
  title: 'Signed speaker release',
})
const slides = fileRequest({ id: 'recReqSlides', entityType: 'submission', title: 'Slides' })

describe('planRequestAssignments', () => {
  it('gives a contact request one row per speaker with no submission', () => {
    const plan = planRequestAssignments({ requests: [release], scopes: [owner, co], existing: [] })

    expect(plan.create).toEqual([
      { fileRequestId: 'recReqRelease', speakerId: OWNER },
      { fileRequestId: 'recReqRelease', speakerId: CO_SPEAKER },
    ])
    expect(plan.skipped).toBe(0)
  })

  it('gives a submission request one row per accepted submission', () => {
    const plan = planRequestAssignments({ requests: [slides], scopes: [co], existing: [] })

    expect(plan.create).toEqual([
      { fileRequestId: 'recReqSlides', speakerId: CO_SPEAKER, submissionId: 'recSub1' },
      { fileRequestId: 'recReqSlides', speakerId: CO_SPEAKER, submissionId: 'recSub2' },
    ])
  })

  it('plans nothing for a speaker with no accepted submission on a submission request', () => {
    const nobody: SpeakerScope = { speaker: speaker({ id: OWNER }), submissionIds: [] }
    const plan = planRequestAssignments({ requests: [slides], scopes: [nobody], existing: [] })

    expect(plan.create).toEqual([])
  })

  it('is a no-op when every row already exists', () => {
    const existing = [
      requestAssignment({ id: 'recA', fileRequestId: 'recReqRelease', speakerId: OWNER }),
    ]
    const plan = planRequestAssignments({ requests: [release], scopes: [owner], existing })

    expect(plan.create).toEqual([])
    expect(plan.skipped).toBe(1)
  })

  it('skips only the tuple that exists, and still creates the others', () => {
    const existing = [
      requestAssignment({
        id: 'recA',
        fileRequestId: 'recReqSlides',
        speakerId: CO_SPEAKER,
        submissionId: 'recSub1',
      }),
    ]
    const plan = planRequestAssignments({ requests: [slides], scopes: [co], existing })

    expect(plan.create).toEqual([
      { fileRequestId: 'recReqSlides', speakerId: CO_SPEAKER, submissionId: 'recSub2' },
    ])
    expect(plan.skipped).toBe(1)
  })

  it('counts a duplicate row in the base once, not twice', () => {
    const twice = [
      requestAssignment({ id: 'recA', fileRequestId: 'recReqRelease', speakerId: OWNER }),
      requestAssignment({ id: 'recB', fileRequestId: 'recReqRelease', speakerId: OWNER }),
    ]
    const plan = planRequestAssignments({ requests: [release], scopes: [owner], existing: twice })

    expect(plan.create).toEqual([])
    // Two rows describe one tuple, and one tuple was asked for, so exactly one was skipped.
    expect(plan.skipped).toBe(1)
  })

  it('does not plan the same tuple twice within one run', () => {
    const plan = planRequestAssignments({
      requests: [release, release],
      scopes: [owner],
      existing: [],
    })

    expect(plan.create).toHaveLength(1)
    expect(plan.skipped).toBe(1)
  })
})

describe('requestAssignmentKey', () => {
  it('separates a contact row from a submission row for the same speaker', () => {
    const contact = requestAssignmentKey({ fileRequestId: 'recReq1', speakerId: OWNER })
    const scoped = requestAssignmentKey({
      fileRequestId: 'recReq1',
      speakerId: OWNER,
      submissionId: 'recSub1',
    })

    expect(contact).not.toBe(scoped)
  })
})

describe('mapFileRequestAssignmentIfIntact, found by Codex review', () => {
  // The worst of the six, and the same global-orphan failure already fixed for task
  // assignments: `loadRequestGraph` maps every assignment in the base BEFORE filtering by
  // event, and both links are required, so one row whose request or speaker had been deleted
  // (Airtable empties the link, it does not remove the row) took down the admin table, every
  // speaker's Requested Files card, and upload authorization, for every event.
  const intact = {
    id: 'recAsg1',
    fields: { fileRequest: ['recReq1'], speaker: ['recSpk1'], status: 'pending' },
  }

  it('maps a row whose links are both present', () => {
    expect(mapFileRequestAssignmentIfIntact(intact)?.fileRequestId).toBe('recReq1')
  })

  it('skips a row whose request has been deleted instead of throwing', () => {
    expect(
      mapFileRequestAssignmentIfIntact({
        ...intact,
        fields: { ...intact.fields, fileRequest: [] },
      }),
    ).toBeUndefined()
  })

  it('skips a row whose speaker has been deleted instead of throwing', () => {
    expect(
      mapFileRequestAssignmentIfIntact({ ...intact, fields: { ...intact.fields, speaker: [] } }),
    ).toBeUndefined()
  })

  it('still throws for a single record read, where the caller named THAT row', () => {
    expect(() =>
      mapFileRequestAssignment({ ...intact, fields: { ...intact.fields, speaker: [] } }),
    ).toThrow()
  })
})
