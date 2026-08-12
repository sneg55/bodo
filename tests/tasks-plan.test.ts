// What an assignment run would write: one row per to-do, and never a second one.

import { describe, expect, it } from 'vitest'

import { assignmentKey, planAssignments } from '@/features/tasks/plan'
import type { SpeakerScope } from '@/features/tasks/scope'

import { assignment, CO_SPEAKER, OWNER, speaker, task } from './helpers/portal-fakes'

const owner: SpeakerScope = {
  speaker: speaker({ id: OWNER }),
  submissionIds: ['recSub1'],
}
const co: SpeakerScope = {
  speaker: speaker({ id: CO_SPEAKER, firstName: 'Bo', lastName: 'Lin' }),
  submissionIds: ['recSub1', 'recSub2'],
}

const headshot = task({ id: 'recTaskHeadshot', entityType: 'contact', title: 'Upload a headshot' })
const conduct = task({ id: 'recTaskConduct', entityType: 'group', title: 'Read the code' })
const slides = task({ id: 'recTaskSlides', entityType: 'submission', title: 'Upload your slides' })

describe('planAssignments', () => {
  it('gives a contact task one row per speaker with no submission', () => {
    const plan = planAssignments({ tasks: [headshot], scopes: [owner, co], existing: [] })

    expect(plan.create).toEqual([
      { taskId: 'recTaskHeadshot', speakerId: OWNER },
      { taskId: 'recTaskHeadshot', speakerId: CO_SPEAKER },
    ])
    expect(plan.skipped).toBe(0)
  })

  it('treats a group task the same way as a contact task', () => {
    const plan = planAssignments({ tasks: [conduct], scopes: [owner], existing: [] })

    expect(plan.create).toEqual([{ taskId: 'recTaskConduct', speakerId: OWNER }])
  })

  it('gives a submission task one row per accepted submission', () => {
    const plan = planAssignments({ tasks: [slides], scopes: [co], existing: [] })

    expect(plan.create).toEqual([
      { taskId: 'recTaskSlides', speakerId: CO_SPEAKER, submissionId: 'recSub1' },
      { taskId: 'recTaskSlides', speakerId: CO_SPEAKER, submissionId: 'recSub2' },
    ])
  })

  it('gives a speaker with three accepted submissions three rows for one task', () => {
    const three: SpeakerScope = {
      speaker: speaker({ id: OWNER }),
      submissionIds: ['recSub1', 'recSub2', 'recSub3'],
    }
    const plan = planAssignments({ tasks: [slides], scopes: [three], existing: [] })

    expect(plan.create.map((row) => row.submissionId)).toEqual(['recSub1', 'recSub2', 'recSub3'])
  })

  it('builds the whole three-task checklist in one run', () => {
    const plan = planAssignments({
      tasks: [headshot, conduct, slides],
      scopes: [owner],
      existing: [],
    })

    // Two contact-scoped rows plus one per accepted submission. This is the shape the
    // acceptance criterion counts as 1/3 once one of them is done.
    expect(plan.create).toHaveLength(3)
    expect(plan.skipped).toBe(0)
  })

  it('skips a tuple that already has a row, so assigning twice is a no-op', () => {
    const existing = [assignment({ id: 'recAsgOld', taskId: 'recTaskHeadshot', speakerId: OWNER })]
    const plan = planAssignments({ tasks: [headshot], scopes: [owner], existing })

    expect(plan.create).toEqual([])
    expect(plan.skipped).toBe(1)
  })

  it('does not treat a submission-scoped row as covering another submission', () => {
    const existing = [
      assignment({
        id: 'recAsg1',
        taskId: 'recTaskSlides',
        speakerId: CO_SPEAKER,
        submissionId: 'recSub1',
      }),
    ]
    const plan = planAssignments({ tasks: [slides], scopes: [co], existing })

    expect(plan.create).toEqual([
      { taskId: 'recTaskSlides', speakerId: CO_SPEAKER, submissionId: 'recSub2' },
    ])
    expect(plan.skipped).toBe(1)
  })

  it('does not emit the same tuple twice from one run', () => {
    const duplicated: SpeakerScope = { ...owner, submissionIds: ['recSub1', 'recSub1'] }
    const plan = planAssignments({ tasks: [slides], scopes: [duplicated], existing: [] })

    expect(plan.create).toHaveLength(1)
    expect(plan.skipped).toBe(1)
  })

  it('invents no row for a submission task when the speaker has no accepted submission', () => {
    const empty: SpeakerScope = { speaker: speaker({ id: OWNER }), submissionIds: [] }
    const plan = planAssignments({ tasks: [slides], scopes: [empty], existing: [] })

    expect(plan.create).toEqual([])
    expect(plan.skipped).toBe(0)
  })

  it('plans nothing when there is nobody accepted or nothing selected', () => {
    expect(planAssignments({ tasks: [headshot], scopes: [], existing: [] }).create).toEqual([])
    expect(planAssignments({ tasks: [], scopes: [owner], existing: [] }).create).toEqual([])
  })
})

describe('assignmentKey', () => {
  it('keeps a contact tuple distinct from a submission tuple on the same task', () => {
    expect(assignmentKey({ taskId: 'recT', speakerId: 'recS' })).not.toBe(
      assignmentKey({ taskId: 'recT', speakerId: 'recS', submissionId: 'recSub1' }),
    )
  })
})
