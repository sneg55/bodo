// What "done" means per task kind, and what it refuses.
//
// The failure worth guarding is the quiet one: a completion accepted with no evidence
// marks a speaker done on the organizer's dashboard and nobody goes looking for it.

import { describe, expect, it } from 'vitest'

import { buildCompletion, completionPrompt } from '@/features/portal/task-completion'
import { syncErrorIdOf } from './helpers/auth-fakes'
import { field, form, task } from './helpers/portal-fakes'

describe('buildCompletion: upload', () => {
  const upload = task({ kind: 'upload' })

  it('stores the file id', () => {
    expect(buildCompletion({ task: upload, submitted: { fileId: 'recFile1' } }).answers).toEqual({
      fileId: 'recFile1',
    })
  })

  it('refuses when no file was uploaded', () => {
    expect(syncErrorIdOf(() => buildCompletion({ task: upload, submitted: {} }))).toBe('E_SUB_003')
  })

  it('refuses a whitespace-only file id', () => {
    expect(
      syncErrorIdOf(() => buildCompletion({ task: upload, submitted: { fileId: '  ' } })),
    ).toBe('E_SUB_003')
  })
})

describe('buildCompletion: confirm and link', () => {
  it('records the confirmation rather than a bare true', () => {
    const confirm = task({ kind: 'confirm' })
    expect(buildCompletion({ task: confirm, submitted: { confirmed: true } }).answers).toEqual({
      confirmed: true,
    })

    const link = task({ kind: 'link' })
    expect(buildCompletion({ task: link, submitted: { confirmed: true } }).answers).toEqual({
      visitConfirmed: true,
    })
  })

  it('refuses an unticked box', () => {
    expect(
      syncErrorIdOf(() =>
        buildCompletion({ task: task({ kind: 'confirm' }), submitted: { confirmed: false } }),
      ),
    ).toBe('E_SUB_003')
    expect(
      syncErrorIdOf(() => buildCompletion({ task: task({ kind: 'link' }), submitted: {} })),
    ).toBe('E_SUB_003')
  })
})

describe('buildCompletion: form', () => {
  const questions = form({
    fields: [
      field({ id: 'fld_a', label: 'Session length', required: true }),
      field({ id: 'fld_b', label: 'Anything else', required: false }),
    ],
  })
  const formTask = task({ kind: 'form', formId: questions.id })

  it('returns problems instead of throwing, so the portal can render them per field', () => {
    const result = buildCompletion({ task: formTask, form: questions, submitted: { answers: {} } })

    expect(result.problems.map((problem) => problem.fieldId)).toEqual(['fld_a'])
    expect(result.answers).toEqual({})
  })

  it('stores the sanitized answers when it validates', () => {
    const result = buildCompletion({
      task: formTask,
      form: questions,
      submitted: { answers: { fld_a: '30 minutes' } },
    })

    expect(result.problems).toEqual([])
    expect(result.answers).toEqual({ fld_a: '30 minutes' })
  })

  it('drops an answer to a question the form does not ask', () => {
    // An open POST can carry anything. Storing it would file an answer to a question the
    // speaker was never shown.
    const result = buildCompletion({
      task: formTask,
      form: questions,
      submitted: { answers: { fld_a: 'yes', fld_unknown: 'injected' } },
    })

    expect(result.answers).toEqual({ fld_a: 'yes' })
  })

  it('refuses a form task with no form linked', () => {
    expect(
      syncErrorIdOf(() => buildCompletion({ task: formTask, submitted: { answers: {} } })),
    ).toBe('E_MAIL_002')
  })
})

describe('completionPrompt', () => {
  it('has copy for all four kinds', () => {
    for (const kind of ['upload', 'form', 'link', 'confirm'] as const) {
      expect(completionPrompt(kind)).not.toBe('Complete this task')
    }
  })
})
