// Assigning a portal form: what stops it, and the task that carries it.

import { describe, expect, it } from 'vitest'

import { planFormTask, portalFormAssignBlocker } from '@/features/portal-forms/task-plan'

import { field, form, task } from './helpers/portal-fakes'

const question = field({ id: 'q_name', label: 'Preferred name' })

const contactForm = form({
  id: 'recFormContact',
  kind: 'task',
  entityType: 'contact',
  name: 'Speaker Contact Form',
  fields: [question],
})

describe('portalFormAssignBlocker', () => {
  it('allows a typed portal form with at least one question', () => {
    expect(portalFormAssignBlocker(contactForm)).toBeUndefined()
  })

  it('refuses a CFP form', () => {
    expect(portalFormAssignBlocker(form({ kind: 'cfp', fields: [question] }))).toBe(
      'that form is not a portal form',
    )
  })

  it('refuses a portal form with no type, rather than guessing an audience', () => {
    const untyped = form({ kind: 'task', entityType: undefined, fields: [question] })

    expect(portalFormAssignBlocker(untyped)).toContain('no type yet')
  })

  it('refuses a portal form with no questions, which would complete over nothing', () => {
    expect(portalFormAssignBlocker(form({ ...contactForm, fields: [] }))).toContain('no questions')
  })
})

describe('planFormTask', () => {
  it('describes a form-kind task titled after the form when nothing carries it yet', () => {
    const plan = planFormTask({ form: contactForm, entityType: 'contact', tasks: [] })

    expect(plan).toEqual({
      create: {
        title: 'Speaker Contact Form',
        entityType: 'contact',
        kind: 'form',
        formId: 'recFormContact',
      },
    })
  })

  it('reuses the existing task, so assigning twice fans out no second checklist', () => {
    const carrier = task({
      id: 'recTaskForm',
      kind: 'form',
      entityType: 'contact',
      formId: 'recFormContact',
    })
    const plan = planFormTask({ form: contactForm, entityType: 'contact', tasks: [carrier] })

    expect(plan).toEqual({ reuse: carrier })
  })

  it('ignores a task that links a different form', () => {
    const other = task({ id: 'recTaskOther', kind: 'form', entityType: 'contact', formId: 'recX' })
    const plan = planFormTask({ form: contactForm, entityType: 'contact', tasks: [other] })

    expect('create' in plan).toBe(true)
  })

  it('ignores a task that links this form but is not a form task', () => {
    const upload = task({
      id: 'recTaskUpload',
      kind: 'upload',
      entityType: 'contact',
      formId: 'recFormContact',
    })
    const plan = planFormTask({ form: contactForm, entityType: 'contact', tasks: [upload] })

    expect('create' in plan).toBe(true)
  })

  it('creates a second task when the audience changed, rather than re-scoping the first', () => {
    const contactCarrier = task({
      id: 'recTaskForm',
      kind: 'form',
      entityType: 'contact',
      formId: 'recFormContact',
    })
    const plan = planFormTask({
      form: { ...contactForm, entityType: 'submission' },
      entityType: 'submission',
      tasks: [contactCarrier],
    })

    expect(plan).toEqual({
      create: {
        title: 'Speaker Contact Form',
        entityType: 'submission',
        kind: 'form',
        formId: 'recFormContact',
      },
    })
  })
})
