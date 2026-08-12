// Who still owes work, and what they owe. CNT-08, SPK-16.
//
// This is the resolution both the organizer's button and the scheduled sweep read, so the
// cases worth pinning are the ones that would chase the wrong person: a speaker who has
// finished everything, a duplicate assignment row counted twice, and somebody with no address
// counted into a confirmation that says how many were mailed.

import { describe, expect, it } from 'vitest'

import { outstandingTaskRows, selectedOutstanding } from '@/features/comms/outstanding-tasks'
import type { SpeakerScope } from '@/features/tasks/scope'
import type { TaskAssignmentItem } from '@/services/airtable/reads-portal'
import type { Speaker, Task, TaskAssignment } from '@/types/domain'

function speaker(overrides: Partial<Speaker> & Pick<Speaker, 'id'>): Speaker {
  return {
    email: `${overrides.id}@example.com`,
    firstName: 'Ada',
    lastName: 'Lovelace',
    // Required on `Speaker`; empty is its resting state. Spread last so a case can override it.
    links: {},
    ...overrides,
  }
}

function scope(person: Speaker): SpeakerScope {
  return { speaker: person, submissionIds: ['recSub'] }
}

function item(input: {
  taskId: string
  title: string
  speakerId: string
  status?: TaskAssignment['status']
  dueAt?: string
  assignmentId?: string
  submissionId?: string
}): TaskAssignmentItem {
  const task: Task = {
    id: input.taskId,
    eventId: 'recEvent',
    title: input.title,
    entityType: 'contact',
    origin: 'manual',
    kind: 'upload',
    ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt }),
  }
  const assignment: TaskAssignment = {
    id: input.assignmentId ?? `assign-${input.taskId}-${input.speakerId}`,
    taskId: input.taskId,
    speakerId: input.speakerId,
    status: input.status ?? 'pending',
    ...(input.submissionId === undefined ? {} : { submissionId: input.submissionId }),
  }
  return { task, assignment }
}

const ada = speaker({ id: 'recAda', firstName: 'Ada' })
const grace = speaker({ id: 'recGrace', firstName: 'Grace' })
const timeZone = 'UTC'

describe('outstandingTaskRows', () => {
  it('names each outstanding task and its due date, soonest first', () => {
    const [row] = outstandingTaskRows({
      scopes: [scope(ada)],
      items: [
        item({
          taskId: 'recLate',
          title: 'Send slides',
          speakerId: 'recAda',
          dueAt: '2026-09-01T00:00:00.000Z',
        }),
        item({
          taskId: 'recSoon',
          title: 'Upload headshot',
          speakerId: 'recAda',
          dueAt: '2026-08-20T00:00:00.000Z',
        }),
      ],
      timeZone,
    })

    expect(row.name).toBe('Ada Lovelace')
    expect(row.tasks.map((task) => task.title)).toEqual(['Upload headshot', 'Send slides'])
    expect(row.tasks[0].dueLabel).toBe('Due Aug 20, 2026')
    expect(row.tasks[0].assignmentId).toBe('assign-recSoon-recAda')
  })

  it('sorts an undated task last, because it is never the thing to do next', () => {
    const [row] = outstandingTaskRows({
      scopes: [scope(ada)],
      items: [
        item({ taskId: 'recAny', title: 'Confirm attendance', speakerId: 'recAda' }),
        item({
          taskId: 'recDue',
          title: 'Upload headshot',
          speakerId: 'recAda',
          dueAt: '2026-08-20T00:00:00.000Z',
        }),
      ],
      timeZone,
    })

    expect(row.tasks.map((task) => task.title)).toEqual(['Upload headshot', 'Confirm attendance'])
    expect(row.tasks[1].dueLabel).toBeUndefined()
  })

  it('leaves out a speaker who has finished everything', () => {
    const rows = outstandingTaskRows({
      scopes: [scope(ada), scope(grace)],
      items: [
        item({ taskId: 'recTask', title: 'Upload headshot', speakerId: 'recAda', status: 'done' }),
        item({ taskId: 'recTask', title: 'Upload headshot', speakerId: 'recGrace' }),
      ],
      timeZone,
    })

    expect(rows.map((row) => row.speakerId)).toEqual(['recGrace'])
  })

  it('counts a duplicated assignment row once, and lets the finished copy win', () => {
    // Airtable has no unique constraint. Two rows for one to-do must not chase somebody
    // twice in one email, and a `done` duplicate must not chase them at all.
    const rows = outstandingTaskRows({
      scopes: [scope(ada)],
      items: [
        item({
          taskId: 'recTask',
          title: 'Upload headshot',
          speakerId: 'recAda',
          assignmentId: 'a1',
        }),
        item({
          taskId: 'recTask',
          title: 'Upload headshot',
          speakerId: 'recAda',
          assignmentId: 'a2',
          status: 'done',
        }),
      ],
      timeZone,
    })

    expect(rows).toEqual([])
  })

  it('drops a speaker with no address, because they cannot be reminded', () => {
    const nameOnly = speaker({ id: 'recNoMail', email: '  ' })
    const rows = outstandingTaskRows({
      scopes: [scope(nameOnly)],
      items: [item({ taskId: 'recTask', title: 'Upload headshot', speakerId: 'recNoMail' })],
      timeZone,
    })

    // Counting them would make the send confirmation claim somebody was mailed who was not.
    expect(rows).toEqual([])
  })
})

describe('selectedOutstanding', () => {
  const rows = outstandingTaskRows({
    scopes: [scope(ada), scope(grace)],
    items: [
      item({ taskId: 'recTask', title: 'Upload headshot', speakerId: 'recAda' }),
      item({ taskId: 'recTask', title: 'Upload headshot', speakerId: 'recGrace' }),
    ],
    timeZone,
  })

  it('filters to the selection', () => {
    expect(selectedOutstanding(rows, ['recAda']).map((row) => row.speakerId)).toEqual(['recAda'])
  })

  it('drops an id that is not behind, rather than mailing it', () => {
    expect(selectedOutstanding(rows, ['recStranger'])).toEqual([])
  })

  it('means everybody behind when nothing is selected', () => {
    expect(selectedOutstanding(rows, [])).toHaveLength(2)
  })
})
