// The data port's default behaviour, which is a deliberate design decision and therefore
// worth pinning: reads answer "nothing", writes REFUSE.
//
// The distinction is the point. An empty task list is a true statement about a base with no
// TaskAssignments rows and it is the state refs 17-18 captured. A completion that reported
// success and stored nothing would tell a speaker they were done while the organizer's
// dashboard never moves, and nobody would ever go looking for it.

import { afterEach, describe, expect, it } from 'vitest'

import { portalDataPort, portalDataPortIsWired, setPortalDataPort } from '@/features/portal/ports'
import { errorIdOf } from './helpers/auth-fakes'
import { assignment, task } from './helpers/portal-fakes'

const original = portalDataPort()

afterEach(() => {
  setPortalDataPort(original)
})

describe('the unprovisioned port', () => {
  it('reads as empty rather than throwing, so the portal renders its empty states', async () => {
    expect(
      await portalDataPort().listTaskAssignments({ eventId: 'recEvent1', speakerId: 'recSpk1' }),
    ).toEqual([])
    expect(await portalDataPort().listSubmissionFiles({ submissionId: 'recSub1' })).toEqual([])
  })

  it('refuses a completion with a write failure rather than reporting success', async () => {
    expect(
      await errorIdOf(
        async () =>
          await portalDataPort().completeTaskAssignment({
            assignmentId: 'recAsg1',
            completedAt: '2026-08-08T00:00:00.000Z',
            answers: {},
          }),
      ),
    ).toBe('E_DATA_003')
  })

  it('refuses an answers save too, so saved progress is never reported over nothing', async () => {
    expect(
      await errorIdOf(
        async () =>
          await portalDataPort().saveTaskAnswers({ assignmentId: 'recAsg1', answers: { q: 'a' } }),
      ),
    ).toBe('E_DATA_003')
  })

  it('reports that it is not wired', () => {
    expect(portalDataPortIsWired()).toBe(false)
  })
})

describe('setPortalDataPort', () => {
  it('is the whole wiring change once the DAL grows task reads', async () => {
    const item = { assignment: assignment(), task: task() }
    const completed: string[] = []
    const saved: Record<string, unknown>[] = []

    setPortalDataPort({
      listTaskAssignments: () => Promise.resolve([item]),
      listSubmissionFiles: () => Promise.resolve([]),
      completeTaskAssignment: (completion) => {
        completed.push(completion.assignmentId)
        return Promise.resolve()
      },
      saveTaskAnswers: (input) => {
        saved.push(input.answers)
        return Promise.resolve()
      },
    })

    expect(portalDataPortIsWired()).toBe(true)
    expect(
      await portalDataPort().listTaskAssignments({ eventId: 'recEvent1', speakerId: 'recSpk1' }),
    ).toEqual([item])

    await portalDataPort().completeTaskAssignment({
      assignmentId: 'recAsg1',
      completedAt: '2026-08-08T00:00:00.000Z',
      answers: {},
    })
    expect(completed).toEqual(['recAsg1'])

    await portalDataPort().saveTaskAnswers({ assignmentId: 'recAsg1', answers: { q_name: 'Ada' } })
    expect(saved).toEqual([{ q_name: 'Ada' }])
  })
})
