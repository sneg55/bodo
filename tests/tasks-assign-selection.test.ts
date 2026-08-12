// What the board's named-speaker assignment is about to do. SPK-09.
//
// One case here matters more than the rest and it is the one the board has that the Add Task
// drawer never does: a selection of SEVERAL tasks where only some are submission-scoped. That
// is where the naive reading silently drops a row. A speaker with no accepted session gets
// nothing from the submission-scoped one, `planFanout` is right to refuse it, and an entry
// point that stayed quiet because the other two landed is exactly how SPK-09 became
// unjudgeable.

import { describe, expect, it } from 'vitest'

import type { TaskEntityType } from '@/constants/status'
import {
  assignSelection,
  assignSelectionSummary,
  entityTypeForWarning,
} from '@/features/tasks/assign-selection'
import type { TaskCardView } from '@/features/tasks/cards'

function card(id: string, entityType: TaskEntityType): TaskCardView {
  return {
    id,
    title: `Task ${id}`,
    entityType,
    typeLabel: entityType,
    kind: 'upload',
    manual: true,
    assigned: 0,
    done: 0,
  }
}

const contactTask = card('recContact', 'contact')
const groupTask = card('recGroup', 'group')
const sessionTask = card('recSession', 'submission')
const otherSessionTask = card('recSession2', 'submission')
const cards = [contactTask, groupTask, sessionTask, otherSessionTask]

describe('assignSelection', () => {
  it('counts the ticked tasks and how many fan out per accepted session', () => {
    expect(assignSelection(cards, ['recContact', 'recSession'])).toEqual({
      tasks: 2,
      submissionScoped: 1,
    })
  })

  it('resolves against the cards, so a stale id is not counted as a task', () => {
    // An id left over from a task deleted since the board rendered. Counting it would make
    // the dialog promise work that has nothing behind it.
    expect(assignSelection(cards, ['recContact', 'recDeleted'])).toEqual({
      tasks: 1,
      submissionScoped: 0,
    })
  })
})

describe('entityTypeForWarning', () => {
  it('warns when ANY ticked task is submission-scoped, not only when all of them are', () => {
    // The mixed case. Staying quiet because two of the three would land is the silent drop.
    expect(entityTypeForWarning(assignSelection(cards, ['recContact', 'recSession']))).toBe(
      'submission',
    )
  })

  it('stands the warning down when nothing in the selection is submission-scoped', () => {
    // A contact or group task fans out one row per person regardless of sessions, so it
    // cannot produce the empty write this guards against, and a warning would be noise.
    expect(entityTypeForWarning(assignSelection(cards, ['recContact', 'recGroup']))).toBe('contact')
  })
})

describe('assignSelectionSummary', () => {
  it('promises a row for everyone when nothing is conditional', () => {
    expect(assignSelectionSummary({ tasks: 2, submissionScoped: 0 })).toBe(
      'Assigning 2 tasks. Every chosen speaker gets a row.',
    )
  })

  it('says a speaker with no accepted session gets nothing, when all are session-scoped', () => {
    const summary = assignSelectionSummary({ tasks: 2, submissionScoped: 2 })

    expect(summary).toContain('all Submissions-scoped')
    expect(summary).toContain('a speaker with none gets nothing')
  })

  it('names HOW MANY of a mixed selection are conditional', () => {
    // The number the picker cannot know, because it is handed one entity type and not the
    // cards. Without it an organizer cannot tell whether the warning covers the whole batch.
    const summary = assignSelectionSummary({ tasks: 3, submissionScoped: 1 })

    expect(summary).toContain('Assigning 3 tasks, of which 1 is Submissions-scoped')
    expect(summary).toContain('that one reaches')
    expect(summary).toContain('gets nothing from it')
  })

  it('reads correctly for a single task and for several', () => {
    expect(assignSelectionSummary({ tasks: 1, submissionScoped: 0 })).toContain('Assigning 1 task.')
    expect(assignSelectionSummary({ tasks: 4, submissionScoped: 2 })).toContain(
      'of which 2 are Submissions-scoped',
    )
  })
})
