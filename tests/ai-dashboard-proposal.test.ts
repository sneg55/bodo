// The `AI prompt` tab's proposal: what survives validation, and what the keyless mock computes.
//
// Everything asserted here is about a value that arrives from OUTSIDE the type system. A model
// answers with whatever it answers with, and the browser then posts that proposal back to the
// create action, so the same object is untrusted twice. `metric` and `color` are Airtable
// single-selects, so a value outside the enum is a write the base rejects, and a rejected write
// on the widget half of `createDashboard` rolls the tab back: the organizer would watch a
// dashboard appear and vanish. Validating here is what stops that reaching the write at all.
//
// The mock's tests pin DETERMINISM rather than a particular sentence. A canned proposal is
// shown to an organizer behind `AI_SAMPLE_NOTICE`, and one that reshuffled between two clicks on
// the same description would look like a model changing its mind rather than like a fixture.

import { describe, expect, it } from 'vitest'

import {
  PROPOSAL_DESCRIPTION_LIMIT,
  PROPOSAL_METRIC_LIMIT,
  PROPOSAL_NAME_LIMIT,
  proposalWidgets,
  validateProposal,
} from '@/features/dashboard/ai-proposal'
import { mockProposal } from '@/features/dashboard/ai-proposal-mock'
import { widgetSpec } from '@/features/dashboard/widget-catalog'
import { DASHBOARD_COLORS, WIDGET_METRICS } from '@/services/airtable/mapping-dashboards'

/** A proposal with everything already valid, so each test can spoil exactly one field. */
function sound(): Record<string, unknown> {
  return {
    name: 'Speaker Readiness',
    color: 'purple',
    description: 'Who has confirmed and what is still outstanding.',
    metrics: ['accepted_speakers', 'speaker_confirmation_mix'],
  }
}

describe('validateProposal', () => {
  it('keeps the metrics the catalogue has and drops the ones it does not', () => {
    const result = validateProposal({
      ...sound(),
      metrics: ['accepted_speakers', 'sponsor_revenue', 'pending_review', 'sessions_by_room'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Dropped, not rejected: a model that names one metric this build cannot draw has still
    // answered the question for the other two, and refusing the lot would waste them.
    expect(result.proposal.metrics).toEqual(['accepted_speakers', 'pending_review'])
  })

  it('falls back on a colour outside DASHBOARD_COLORS instead of failing', () => {
    const result = validateProposal({ ...sound(), color: 'crimson' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(DASHBOARD_COLORS).toContain(result.proposal.color)
    // The same fallback `mapDashboard` gives a colourless row, so a tab always has a dot.
    expect(result.proposal.color).toBe('blue')
  })

  it('collapses a metric named twice', () => {
    const result = validateProposal({
      ...sound(),
      metrics: ['pending_review', 'accepted_speakers', 'pending_review'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // First occurrence wins, so the order the model chose survives the dedup.
    expect(result.proposal.metrics).toEqual(['pending_review', 'accepted_speakers'])
  })

  it('caps a proposal that names more widgets than a dashboard should carry', () => {
    const result = validateProposal({ ...sound(), metrics: [...WIDGET_METRICS] })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.proposal.metrics).toHaveLength(PROPOSAL_METRIC_LIMIT)
    expect(result.proposal.metrics).toEqual(WIDGET_METRICS.slice(0, PROPOSAL_METRIC_LIMIT))
  })

  it('fails when nothing survives, rather than proposing an empty dashboard', () => {
    const result = validateProposal({ ...sound(), metrics: ['sponsor_revenue', 'ticket_sales'] })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/widget/i)
  })

  it('fails on a metrics field that is not a list', () => {
    expect(validateProposal({ ...sound(), metrics: 'accepted_speakers' }).ok).toBe(false)
    expect(validateProposal({ ...sound(), metrics: undefined }).ok).toBe(false)
  })

  it('fails on anything that is not an object', () => {
    expect(validateProposal(null).ok).toBe(false)
    expect(validateProposal('a dashboard').ok).toBe(false)
    expect(validateProposal([sound()]).ok).toBe(false)
  })

  it('cuts the name and the description to the limits the columns hold', () => {
    const result = validateProposal({
      ...sound(),
      name: 'N'.repeat(PROPOSAL_NAME_LIMIT + 40),
      description: 'D'.repeat(PROPOSAL_DESCRIPTION_LIMIT + 40),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.proposal.name).toHaveLength(PROPOSAL_NAME_LIMIT)
    expect(result.proposal.description).toHaveLength(PROPOSAL_DESCRIPTION_LIMIT)
  })

  it('trims the name and the description, and fails on a name that is only spaces', () => {
    const result = validateProposal({ ...sound(), name: '  Speaker Readiness  ' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.proposal.name).toBe('Speaker Readiness')

    // A nameless tab is an unlabelled tab, so this is the one string that has to be there.
    expect(validateProposal({ ...sound(), name: '   ' }).ok).toBe(false)
  })

  it('accepts an absent description, which is a dashboard with no line under its title', () => {
    const result = validateProposal({ ...sound(), description: undefined })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.proposal.description).toBe('')
  })
})

describe('mockProposal', () => {
  it('returns the same proposal every time for the same description', () => {
    const description = 'Show me how many speakers have confirmed and what tasks are outstanding.'

    expect(mockProposal(description)).toEqual(mockProposal(description))
  })

  it('answers different descriptions differently, so it is not one frozen fixture', () => {
    const speakers = mockProposal('speakers who have not confirmed and their outstanding tasks')
    const submissions = mockProposal('submissions by track and how many are still pending review')

    expect(speakers.metrics).not.toEqual(submissions.metrics)
  })

  it('picks the widgets whose catalogue summary matches the words asked for', () => {
    const proposal = mockProposal('confirmed against unconfirmed speakers')

    expect(proposal.metrics).toContain('speaker_confirmation_mix')
  })

  it('still proposes a dashboard when nothing in the description matches', () => {
    const proposal = mockProposal('zzzz')

    // An empty metric list is an error, so a mock that produced one would make a keyless
    // deployment look broken rather than sampled.
    expect(proposal.metrics.length).toBeGreaterThan(0)
  })

  it('produces proposals that pass the same validation a live answer faces', () => {
    for (const description of [
      'outstanding speaker tasks',
      'total submissions by form',
      '',
      'X'.repeat(PROPOSAL_DESCRIPTION_LIMIT + 100),
    ]) {
      const result = validateProposal(mockProposal(description))
      expect(result.ok).toBe(true)
    }
  })
})

describe('proposalWidgets', () => {
  it('takes every title and shape from the catalogue, never from the proposal', () => {
    const widgets = proposalWidgets(['submissions_by_track', 'accepted_speakers'])

    expect(widgets).toEqual([
      {
        title: widgetSpec('submissions_by_track').title,
        widgetType: widgetSpec('submissions_by_track').widgetType,
        metric: 'submissions_by_track',
        order: 0,
      },
      {
        title: widgetSpec('accepted_speakers').title,
        widgetType: widgetSpec('accepted_speakers').widgetType,
        metric: 'accepted_speakers',
        order: 1,
      },
    ])
  })
})
