// Task partitioning, counts, filters, and the flattening that crosses to the client.

import { describe, expect, it } from 'vitest'

import {
  applyTaskFilter,
  groupTasks,
  taskCounts,
  tasksForSubmission,
} from '@/features/portal/task-groups'
import { formatDue, linkFromDescription, toTaskViews } from '@/features/portal/task-view'
import { uploadKindFor } from '@/features/portal/upload-client'

import { assignment, field, form, submission, task } from './helpers/portal-fakes'

const submissionTask = {
  assignment: assignment({ id: 'recAsg1', submissionId: 'recSub1' }),
  task: task({ id: 'recTask1', entityType: 'submission' }),
}
const contactTask = {
  assignment: assignment({ id: 'recAsg2' }),
  task: task({ id: 'recTask2', entityType: 'contact', title: 'Confirm your travel' }),
}
const groupTask = {
  assignment: assignment({ id: 'recAsg3' }),
  task: task({ id: 'recTask3', entityType: 'group', title: 'Read the code of conduct' }),
}

describe('groupTasks', () => {
  it('splits submission-scoped from everything else', () => {
    const grouping = groupTasks([submissionTask, contactTask, groupTask])

    expect(grouping.submission.map((item) => item.task.id)).toEqual(['recTask1'])
    // `group` falls in with contact: there are two sections in the screenshot, and a group
    // task is still something the person has to do.
    expect(grouping.mine.map((item) => item.task.id)).toEqual(['recTask2', 'recTask3'])
  })

  it('counts every assignment, done or not', () => {
    const done = {
      assignment: assignment({ id: 'recAsg4', status: 'done' as const }),
      task: task(),
    }
    const counts = taskCounts(groupTasks([submissionTask, contactTask, done]))

    expect(counts).toEqual({ mine: 1, submission: 2 })
  })
})

describe('tasksForSubmission', () => {
  it('keeps only submission-scoped assignments linked to that submission', () => {
    const other = {
      assignment: assignment({ id: 'recAsg9', submissionId: 'recSubOther' }),
      task: task({ id: 'recTask9', entityType: 'submission' }),
    }

    expect(
      tasksForSubmission([submissionTask, other, contactTask], 'recSub1').map(
        (item) => item.assignment.id,
      ),
    ).toEqual(['recAsg1'])
  })
})

describe('applyTaskFilter', () => {
  const done = {
    assignment: assignment({ id: 'recAsgDone', status: 'done' as const }),
    task: task(),
  }
  const items = [submissionTask, done]

  it('filters to outstanding and to completed, and passes everything through for all', () => {
    expect(applyTaskFilter(items, 'outstanding').map((item) => item.assignment.id)).toEqual([
      'recAsg1',
    ])
    expect(applyTaskFilter(items, 'completed').map((item) => item.assignment.id)).toEqual([
      'recAsgDone',
    ])
    expect(applyTaskFilter(items, 'all')).toHaveLength(2)
  })
})

describe('toTaskViews', () => {
  const row = submission({ id: 'recSub1', code: 'SESS-3', title: 'Why agent plans fail halfway' })

  it('labels a submission task with the same card title the lists use', () => {
    const [view] = toTaskViews({
      items: [submissionTask],
      submissions: [row],
      forms: [],
      timeZone: 'America/Los_Angeles',
    })

    expect(view.submissionLabel).toBe('SESS-3 - Why agent plans fail halfway')
    expect(view.scope).toBe('submission')
  })

  it('carries the linked form fields for a form task and nothing for the others', () => {
    const questions = form({ id: 'recForm9', fields: [field({ id: 'fld_a', label: 'Length' })] })
    const formTask = {
      assignment: assignment({ id: 'recAsgF' }),
      task: task({ id: 'recTaskF', kind: 'form', formId: 'recForm9', entityType: 'contact' }),
    }

    const views = toTaskViews({
      items: [formTask, submissionTask],
      submissions: [row],
      forms: [questions],
      timeZone: 'UTC',
    })

    expect(views.map((view) => view.fields.map((f) => f.label))).toEqual([['Length'], []])
    expect(views.map((view) => view.formMissing)).toEqual([false, false])
  })

  it('carries the saved answers, dropping any whose question the form no longer asks', () => {
    const questions = form({ id: 'recForm9', fields: [field({ id: 'fld_a', label: 'Length' })] })
    const formTask = {
      assignment: assignment({
        id: 'recAsgF',
        answers: { fld_a: '30 minutes', fld_gone: 'answered before the question was deleted' },
      }),
      task: task({ id: 'recTaskF', kind: 'form', formId: 'recForm9', entityType: 'contact' }),
    }

    const [view] = toTaskViews({
      items: [formTask],
      submissions: [row],
      forms: [questions],
      timeZone: 'UTC',
    })

    expect(view.answers).toEqual({ fld_a: '30 minutes' })
  })

  it('flags a form task whose linked form is gone, rather than showing an empty form', () => {
    const formTask = {
      assignment: assignment({ id: 'recAsgF', answers: { fld_a: '30 minutes' } }),
      task: task({ id: 'recTaskF', kind: 'form', formId: 'recFormDeleted' }),
    }

    const [view] = toTaskViews({
      items: [formTask],
      submissions: [row],
      forms: [],
      timeZone: 'UTC',
    })

    expect(view.formMissing).toBe(true)
    expect(view.fields).toEqual([])
    expect(view.answers).toEqual({})
  })

  it('flags a form task that links no form at all', () => {
    const formTask = {
      assignment: assignment({ id: 'recAsgF' }),
      task: task({ id: 'recTaskF', kind: 'form', formId: undefined }),
    }

    const [view] = toTaskViews({
      items: [formTask],
      submissions: [row],
      forms: [],
      timeZone: 'UTC',
    })

    expect(view.formMissing).toBe(true)
  })

  it('keeps no answers on a non-form task, whose answersJson is completion evidence', () => {
    const uploaded = {
      assignment: assignment({ id: 'recAsgU', answers: { fileId: 'recFile1' } }),
      task: task({ id: 'recTaskU', kind: 'upload' }),
    }

    const [view] = toTaskViews({
      items: [uploaded],
      submissions: [row],
      forms: [],
      timeZone: 'UTC',
    })

    expect(view.answers).toEqual({})
    expect(view.formMissing).toBe(false)
  })
})

describe('formatDue', () => {
  it('formats in the event timezone, not the viewer one', () => {
    // Late UTC on the 12th is still the 12th in Los Angeles only if the zone is applied.
    expect(formatDue('2026-10-13T04:00:00.000Z', 'America/Los_Angeles')).toBe('Due Oct 12, 2026')
    expect(formatDue('2026-10-13T04:00:00.000Z', 'UTC')).toBe('Due Oct 13, 2026')
  })

  it('answers nothing for a missing or unparseable date', () => {
    expect(formatDue(undefined, 'UTC')).toBeUndefined()
    expect(formatDue('not a date', 'UTC')).toBeUndefined()
  })
})

describe('uploadKindFor', () => {
  it('routes a deck to slides and everything else to doc', () => {
    // A Tasks row says `kind: 'upload'` and nothing about what sort of file it wants, and
    // the two private kinds accept different type lists, so a deck sent as `doc` would be
    // rejected by the very task that asked for slides.
    expect(
      uploadKindFor('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
    ).toBe('slides')
    expect(uploadKindFor('application/x-iwork-keynote-sffkey')).toBe('slides')
    expect(uploadKindFor('application/pdf')).toBe('doc')
    expect(uploadKindFor('')).toBe('doc')
  })
})

describe('linkFromDescription', () => {
  it('finds the URL an organizer put in the description', () => {
    // The Tasks schema has no url column, so this is where a link task's target lives.
    expect(linkFromDescription('Please read https://example.com/policy first')).toBe(
      'https://example.com/policy',
    )
  })

  it('refuses a javascript: URL, which would run in the speaker session', () => {
    expect(linkFromDescription('click javascript:alert(1)')).toBeUndefined()
  })

  it('answers nothing when there is no description', () => {
    expect(linkFromDescription(undefined)).toBeUndefined()
  })
})
