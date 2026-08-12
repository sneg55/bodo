// The admin Tasks list: card shaping, the four type tabs and their counts, the search box,
// and what enables Create Task.

import { describe, expect, it } from 'vitest'

import { filterTaskCards, type TaskCardView, taskTabs, toTaskCards } from '@/features/tasks/cards'
import {
  EMPTY_TASK_DRAFT,
  isTaskDraftValid,
  TASK_TITLE_MAX,
  toCreateTaskInput,
} from '@/features/tasks/task-draft'
import type { TaskAssignmentItem } from '@/services/airtable/reads-portal'

import { assignment, CO_SPEAKER, form, OWNER, task } from './helpers/portal-fakes'

const travel = task({
  id: 'recTaskTravel',
  entityType: 'contact',
  title: 'Hotel and Travel Reservations',
  description: 'Sign up for the room block',
  kind: 'confirm',
})
const slides = task({
  id: 'recTaskSlides',
  entityType: 'submission',
  title: 'Presentation Upload',
  kind: 'upload',
  dueAt: '2026-10-05T23:59:00.000Z',
})
const av = task({
  id: 'recTaskAv',
  entityType: 'group',
  title: 'AV form',
  kind: 'form',
  formId: 'recForm1',
  origin: 'automated',
})

const items: readonly TaskAssignmentItem[] = [
  { task: travel, assignment: assignment({ id: 'recAsg1', taskId: travel.id, status: 'done' }) },
  {
    task: travel,
    assignment: assignment({ id: 'recAsg2', taskId: travel.id, speakerId: CO_SPEAKER }),
  },
  // Same tuple as recAsg1. Deduplicated, or the card would claim three assignments.
  { task: travel, assignment: assignment({ id: 'recAsg3', taskId: travel.id }) },
  {
    task: slides,
    assignment: assignment({ id: 'recAsg4', taskId: slides.id, submissionId: 'recSub1' }),
  },
]

const cards = toTaskCards({
  tasks: [travel, slides, av],
  items,
  forms: [form({ id: 'recForm1', name: 'AV requirements' })],
  timeZone: 'America/Los_Angeles',
})

describe('toTaskCards', () => {
  it('labels a submission task Session and a contact task Contact, per ref 25', () => {
    expect(cards.map((card) => card.typeLabel)).toEqual(['Contact', 'Session', 'Group'])
  })

  it('flags a manual origin and leaves an automated one unflagged', () => {
    expect(cards.map((card) => card.manual)).toEqual([true, true, false])
  })

  it('counts distinct assignments per task and how many are done', () => {
    expect(cards[0]).toMatchObject({ assigned: 2, done: 1 })
    expect(cards[1]).toMatchObject({ assigned: 1, done: 0 })
    // Defined and never assigned, which is the state the assignment-resolving read cannot
    // show at all.
    expect(cards[2]).toMatchObject({ assigned: 0, done: 0 })
  })

  it('formats the due date in the event timezone and resolves a form name', () => {
    expect(cards[1]?.dueLabel).toBe('Due Oct 5, 2026')
    expect(cards[0]?.dueLabel).toBeUndefined()
    expect(cards[2]?.formName).toBe('AV requirements')
  })
})

describe('taskTabs', () => {
  it('produces the four labels off ref 25 with live counts', () => {
    expect(taskTabs(cards)).toEqual([
      { id: 'all', label: 'All Tasks', count: 3 },
      { id: 'contact', label: 'Contact Tasks', count: 1 },
      { id: 'group', label: 'Group Tasks', count: 1 },
      { id: 'submission', label: 'Submission Tasks', count: 1 },
    ])
  })
})

describe('filterTaskCards', () => {
  it('narrows to a tab', () => {
    expect(filterTaskCards(cards, 'submission', '').map((card) => card.id)).toEqual([
      'recTaskSlides',
    ])
    expect(filterTaskCards(cards, 'all', '')).toHaveLength(3)
  })

  it('searches the title and the description snippet, case insensitively', () => {
    expect(filterTaskCards(cards, 'all', 'PRESENTATION').map((card) => card.id)).toEqual([
      'recTaskSlides',
    ])
    expect(filterTaskCards(cards, 'all', 'room block').map((card) => card.id)).toEqual([
      'recTaskTravel',
    ])
  })

  it('applies the tab and the search together', () => {
    expect(filterTaskCards(cards, 'contact', 'presentation')).toEqual([])
  })
})

describe('isTaskDraftValid', () => {
  it('needs a title', () => {
    expect(isTaskDraftValid(EMPTY_TASK_DRAFT)).toBe(false)
    expect(isTaskDraftValid({ ...EMPTY_TASK_DRAFT, title: '   ' })).toBe(false)
    expect(isTaskDraftValid({ ...EMPTY_TASK_DRAFT, title: 'Upload a headshot' })).toBe(true)
  })

  it('refuses a title over the cap', () => {
    const title = 'x'.repeat(TASK_TITLE_MAX + 1)
    expect(isTaskDraftValid({ ...EMPTY_TASK_DRAFT, title })).toBe(false)
  })

  it('refuses a form task with no form selected', () => {
    const draft = { ...EMPTY_TASK_DRAFT, title: 'AV form', kind: 'form' as const }
    expect(isTaskDraftValid(draft)).toBe(false)
    expect(isTaskDraftValid({ ...draft, formId: 'recForm1' })).toBe(true)
  })
})

describe('toCreateTaskInput', () => {
  it('trims, drops empties, and carries appliesTo when the switch is on', () => {
    expect(
      toCreateTaskInput('recEvent1', {
        ...EMPTY_TASK_DRAFT,
        title: '  Upload a headshot  ',
        description: '',
        dueAt: '2026-09-20T23:59',
      }),
    ).toEqual({
      eventId: 'recEvent1',
      title: 'Upload a headshot',
      description: undefined,
      entityType: 'contact',
      kind: 'confirm',
      formId: undefined,
      dueAt: '2026-09-20T23:59',
      appliesTo: 'all_accepted',
    })
  })

  it('drops the form link for a non-form kind, so switching kind cannot leave a stale one', () => {
    const input = toCreateTaskInput('recEvent1', {
      ...EMPTY_TASK_DRAFT,
      title: 'Confirm travel',
      kind: 'confirm',
      formId: 'recForm1',
      appliesToAllAccepted: false,
    })

    expect(input.formId).toBeUndefined()
    expect(input.appliesTo).toBeUndefined()
  })
})

describe('card payload', () => {
  it('sends only what the list renders', () => {
    const keys: readonly (keyof TaskCardView)[] = [
      'id',
      'title',
      'description',
      'entityType',
      'typeLabel',
      'kind',
      'manual',
      'dueLabel',
      'formName',
      'assigned',
      'done',
    ]

    for (const card of cards) {
      expect(Object.keys(card).sort()).toEqual([...keys].sort())
    }
  })
})
