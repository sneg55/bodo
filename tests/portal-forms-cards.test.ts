// The admin Portals > Forms list: what makes a portal form a portal form, and the two-hop
// count from a form to the assignments its task created.

import { describe, expect, it } from 'vitest'

import {
  filterPortalFormCards,
  findPortalForm,
  NO_TYPE_LABEL,
  portalForms,
  portalFormTabs,
  toPortalFormCards,
} from '@/features/portal-forms/cards'

import { assignment, CO_SPEAKER, form, OWNER, task } from './helpers/portal-fakes'

const contactForm = form({
  id: 'recFormContact',
  kind: 'task',
  entityType: 'contact',
  name: 'Speaker Contact Form',
  welcomeHtml: '<p>Please add or <strong>update</strong> your information below.</p>',
  fields: [{ id: 'q1', type: 'text', label: 'Dietary requirements', required: true }],
})
const sessionForm = form({
  id: 'recFormSession',
  kind: 'task',
  entityType: 'submission',
  name: 'Session AV Form',
  fields: [],
})
const cfpForm = form({ id: 'recFormCfp', kind: 'cfp', name: 'Call for Speakers' })

describe('portalForms', () => {
  it('keeps only the task-kind rows, which is the whole difference from the CFP list', () => {
    expect(portalForms([contactForm, cfpForm, sessionForm]).map((row) => row.id)).toEqual([
      'recFormContact',
      'recFormSession',
    ])
  })

  it('answers nothing for an event with no portal forms', () => {
    expect(portalForms([cfpForm])).toEqual([])
  })
})

describe('findPortalForm', () => {
  it('resolves a task-kind form by id', () => {
    expect(findPortalForm([contactForm, cfpForm], 'recFormContact')?.name).toBe(
      'Speaker Contact Form',
    )
  })

  it('refuses a CFP form id, so the portal editor cannot open a call for papers', () => {
    expect(findPortalForm([contactForm, cfpForm], 'recFormCfp')).toBeUndefined()
  })

  it('refuses an id that is not on the list at all', () => {
    expect(findPortalForm([contactForm], 'recFormOther')).toBeUndefined()
  })
})

describe('toPortalFormCards', () => {
  it('labels a submission-typed form Session and counts its questions', () => {
    const cards = toPortalFormCards({ forms: [sessionForm], tasks: [], assignments: [] })

    expect(cards[0]?.typeLabel).toBe('Session')
    expect(cards[0]?.questions).toBe(0)
  })

  it('flattens the welcome HTML into a one-line snippet', () => {
    const cards = toPortalFormCards({ forms: [contactForm], tasks: [], assignments: [] })

    expect(cards[0]?.instructions).toBe('Please add or update your information below.')
  })

  it('says the type is not set rather than defaulting a blank column to contact', () => {
    const untyped = form({ id: 'recFormBlank', kind: 'task', entityType: undefined })
    const cards = toPortalFormCards({ forms: [untyped], tasks: [], assignments: [] })

    expect(cards[0]?.entityType).toBeUndefined()
    expect(cards[0]?.typeLabel).toBe(NO_TYPE_LABEL)
  })

  it('reports a form nobody has been assigned as zero of zero', () => {
    const cards = toPortalFormCards({ forms: [contactForm], tasks: [], assignments: [] })

    expect(cards[0]?.assigned).toBe(0)
    expect(cards[0]?.done).toBe(0)
  })

  it('counts the assignments of the task that links the form, two hops away', () => {
    const linked = task({ id: 'recTaskContact', kind: 'form', formId: 'recFormContact' })
    const cards = toPortalFormCards({
      forms: [contactForm],
      tasks: [linked],
      assignments: [
        assignment({ id: 'recA1', taskId: linked.id, speakerId: OWNER, status: 'done' }),
        assignment({ id: 'recA2', taskId: linked.id, speakerId: CO_SPEAKER }),
      ],
    })

    expect(cards[0]?.assigned).toBe(2)
    expect(cards[0]?.done).toBe(1)
  })

  it('counts two rows for one tuple once, with done winning', () => {
    const linked = task({ id: 'recTaskContact', kind: 'form', formId: 'recFormContact' })
    const cards = toPortalFormCards({
      forms: [contactForm],
      tasks: [linked],
      assignments: [
        assignment({ id: 'recA1', taskId: linked.id, speakerId: OWNER }),
        assignment({ id: 'recA2', taskId: linked.id, speakerId: OWNER, status: 'done' }),
      ],
    })

    expect(cards[0]?.assigned).toBe(1)
    expect(cards[0]?.done).toBe(1)
  })

  it('ignores an assignment whose task links no form at all', () => {
    const upload = task({ id: 'recTaskUpload', kind: 'upload', formId: undefined })
    const cards = toPortalFormCards({
      forms: [contactForm],
      tasks: [upload],
      assignments: [assignment({ id: 'recA1', taskId: upload.id, speakerId: OWNER })],
    })

    expect(cards[0]?.assigned).toBe(0)
  })

  it('never produces a card for a CFP form', () => {
    const cards = toPortalFormCards({ forms: [cfpForm], tasks: [], assignments: [] })

    expect(cards).toEqual([])
  })
})

describe('portalFormTabs', () => {
  it('carries the four transcribed labels with live counts', () => {
    const cards = toPortalFormCards({
      forms: [contactForm, sessionForm],
      tasks: [],
      assignments: [],
    })

    expect(portalFormTabs(cards)).toEqual([
      { id: 'all', label: 'All Forms', count: 2 },
      { id: 'contact', label: 'Contact Forms', count: 1 },
      { id: 'group', label: 'Group Forms', count: 0 },
      { id: 'submission', label: 'Submission Forms', count: 1 },
    ])
  })

  it('counts an untyped form under All Forms only', () => {
    const cards = toPortalFormCards({
      forms: [form({ id: 'recFormBlank', kind: 'task', entityType: undefined })],
      tasks: [],
      assignments: [],
    })
    const counts = portalFormTabs(cards)

    expect(counts.at(0)?.count).toBe(1)
    expect(counts.slice(1).map((tab) => tab.count)).toEqual([0, 0, 0])
  })
})

describe('filterPortalFormCards', () => {
  const cards = toPortalFormCards({
    forms: [contactForm, sessionForm],
    tasks: [],
    assignments: [],
  })

  it('applies the tab and the search together', () => {
    expect(filterPortalFormCards(cards, 'contact', '').map((card) => card.id)).toEqual([
      'recFormContact',
    ])
    expect(filterPortalFormCards(cards, 'all', 'av').map((card) => card.id)).toEqual([
      'recFormSession',
    ])
    expect(filterPortalFormCards(cards, 'contact', 'av')).toEqual([])
  })

  it('searches the snippet as well as the name, since both are on the card', () => {
    expect(filterPortalFormCards(cards, 'all', 'dietary')).toEqual([])
    expect(filterPortalFormCards(cards, 'all', 'update your information')).toHaveLength(1)
  })
})
