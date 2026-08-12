// Which tasks ref 25's `Manual` chip is true of, on both screens that draw it.
//
// "Speaker Travel and AV Form" renders its questions inline in the speaker's portal and
// was chipped `Manual` there and on the organizer's card at the same time. The chip's copy
// is transcribed correctly; the classification behind it was `origin === 'manual'`, and
// `origin` defaults to `manual` whenever the Airtable cell is blank (`mapTask`), so a
// form-backed task claimed to be manual by default.

import { describe, expect, it } from 'vitest'

import { isManualTask, toTaskViews } from '@/features/portal/task-view'
import { toTaskCards } from '@/features/tasks/cards'

import { assignment, form, task } from './helpers/portal-fakes'

const travelForm = task({
  id: 'recTaskTravelAv',
  title: 'Speaker Travel and AV Form',
  entityType: 'contact',
  kind: 'form',
  formId: 'recForm1',
  origin: 'manual',
})

const slides = task({ id: 'recTaskSlides', title: 'Presentation Upload', kind: 'upload' })

describe('isManualTask', () => {
  it('refuses the chip to a form-backed task whatever its origin says', () => {
    expect(isManualTask(travelForm)).toBe(false)
    expect(isManualTask({ origin: 'automated', kind: 'form' })).toBe(false)
  })

  it('keeps it on the tasks ref 25 actually captured', () => {
    // Ref 25's three cards are an upload, a confirm and a link, all manual, all chipped.
    expect(isManualTask(slides)).toBe(true)
    expect(isManualTask({ origin: 'manual', kind: 'confirm' })).toBe(true)
    expect(isManualTask({ origin: 'automated', kind: 'upload' })).toBe(false)
  })
})

describe('the two surfaces that draw the chip', () => {
  it('agrees on the organizer card, which names the form instead', () => {
    const [card] = toTaskCards({
      tasks: [travelForm],
      items: [],
      forms: [form({ id: 'recForm1', name: 'Speaker Travel and AV' })],
      timeZone: 'America/Los_Angeles',
    })

    expect(card).toMatchObject({ manual: false, formName: 'Speaker Travel and AV' })
  })

  it('agrees on the speaker list, where the task expands into its own questions', () => {
    const [view] = toTaskViews({
      items: [{ task: travelForm, assignment: assignment({ taskId: travelForm.id }) }],
      submissions: [],
      forms: [form({ id: 'recForm1', name: 'Speaker Travel and AV' })],
      timeZone: 'America/Los_Angeles',
    })

    expect(view.manual).toBe(false)
  })
})
