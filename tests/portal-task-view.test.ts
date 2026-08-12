// What a speaker's task card carries, for the parts that were silently dropped.
//
// The portal form builder's step 2 tells the organizer their `Description & Instructions` will
// appear above the questions their speakers answer. It did not: `toTaskViews` copied the linked
// form's `fields` and nothing else, so every word typed into that editor was invisible to the one
// person it was written for, and the builder's own promise was false. Found by Codex review while
// auditing the shared rich text editor's call sites, and it is the failure this project is
// otherwise careful about: a control whose value nothing reads.

import { describe, expect, it } from 'vitest'
import { toTaskViews } from '@/features/portal/task-view'
import type { Form } from '@/types/forms'

const ZONE = 'America/Los_Angeles'

const FORM = {
  id: 'recForm1',
  eventId: 'recEvent1',
  name: 'Speaker checklist',
  kind: 'task',
  status: 'published',
  publicId: 'pub-1',
  welcomeHtml: '<p>Please answer <strong>all</strong> of these before the rehearsal.</p>',
  fields: [{ id: 'f1', label: 'Shirt size', type: 'text', required: false }],
  participantFields: [],
} as unknown as Form

function itemFor(kind: 'form' | 'upload', formId: string | undefined) {
  return {
    task: {
      id: 'recTask1',
      eventId: 'recEvent1',
      title: 'Speaker checklist',
      kind,
      entityType: 'contact',
      origin: 'manual',
      formId,
    },
    assignment: { id: 'recAsg1', taskId: 'recTask1', speakerId: 'recSp1', status: 'pending' },
  } as unknown as Parameters<typeof toTaskViews>[0]['items'][number]
}

describe('toTaskViews, form instructions', () => {
  it('carries the form instructions so the speaker can read them', () => {
    const [view] = toTaskViews({
      items: [itemFor('form', 'recForm1')],
      submissions: [],
      forms: [FORM],
      timeZone: ZONE,
    })

    expect(view.instructionsHtml).toBe(FORM.welcomeHtml)
    // The fields still come through: this was added beside them, not instead of them.
    expect(view.fields.map((field) => field.id)).toEqual(['f1'])
  })

  it('carries no instructions for a task that is not a form', () => {
    // An upload task's `answersJson` is completion evidence rather than answers, and it has no
    // linked form at all, so a stray instructions block would be another form's copy.
    const [view] = toTaskViews({
      items: [itemFor('upload', undefined)],
      submissions: [],
      forms: [FORM],
      timeZone: ZONE,
    })

    expect(view.instructionsHtml).toBeUndefined()
    expect(view.fields).toEqual([])
    expect(view.formMissing).toBe(false)
  })

  it('reports a form-kind task whose form is gone rather than rendering an empty one', () => {
    // Airtable has no referential integrity, so a deleted or retyped form leaves the task
    // pointing at nothing. `formMissing` is what lets the card say so.
    const [view] = toTaskViews({
      items: [itemFor('form', 'recDeleted')],
      submissions: [],
      forms: [FORM],
      timeZone: ZONE,
    })

    expect(view.formMissing).toBe(true)
    expect(view.instructionsHtml).toBeUndefined()
    expect(view.fields).toEqual([])
  })

  it('leaves instructions undefined when the organizer wrote none', () => {
    const [view] = toTaskViews({
      items: [itemFor('form', 'recForm1')],
      submissions: [],
      forms: [{ ...FORM, welcomeHtml: undefined }],
      timeZone: ZONE,
    })

    expect(view.instructionsHtml).toBeUndefined()
  })
})
