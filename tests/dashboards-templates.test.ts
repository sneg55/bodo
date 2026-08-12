// The New Dashboard gallery, ref 40, and the widget sets its cards create.
//
// Two kinds of assertion here. The transcribed ones (titles, categories, mode labels) are the
// parity target, and they are pinned so a well-meant rewording is caught here instead of in a
// screenshot diff nobody runs. The structural ones are about a failure that has no UI symptom: a
// template's metrics go into an Airtable single-select, so a value outside `WIDGET_METRICS` is a
// write Airtable rejects at instantiation, and a duplicate key is a card that silently creates
// the wrong dashboard.

import { describe, expect, it } from 'vitest'

import { DASHBOARD_MODES } from '@/features/dashboard/dashboard-modes'
import {
  DASHBOARD_TEMPLATES,
  dashboardTemplate,
  TEMPLATE_CATEGORIES,
  templateWidgets,
} from '@/features/dashboard/dashboard-templates'
import { widgetSpec } from '@/features/dashboard/widget-catalog'
import { WIDGET_METRICS } from '@/services/airtable/mapping-dashboards'

describe('DASHBOARD_TEMPLATES', () => {
  it('covers the six cards ref 40 shows, in the order it shows them', () => {
    expect(DASHBOARD_TEMPLATES.map((template) => template.title)).toEqual([
      'Event Overview',
      'Submissions Pipeline',
      'Speaker Tracking',
      'Review Progress',
      'Evaluation Plans by Tracks',
      'Schedule Health',
    ])
  })

  it('carries ref 40s category chips', () => {
    expect(DASHBOARD_TEMPLATES.map((template) => template.category)).toEqual([
      'OVERVIEW',
      'SUBMISSIONS',
      'SPEAKERS',
      'EVALUATION',
      'EVALUATION',
      'AGENDA',
    ])
    // Every chip the parity doc names is used by at least one card.
    for (const category of TEMPLATE_CATEGORIES) {
      expect(DASHBOARD_TEMPLATES.some((template) => template.category === category)).toBe(true)
    }
  })

  it('has unique keys, since the key is what instantiation posts', () => {
    const keys = DASHBOARD_TEMPLATES.map((template) => template.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('only names metrics the Airtable select actually holds', () => {
    for (const template of DASHBOARD_TEMPLATES) {
      for (const metric of template.metrics) {
        expect(WIDGET_METRICS).toContain(metric)
      }
    }
  })

  it('describes every card, since the description is also the dashboard description line', () => {
    for (const template of DASHBOARD_TEMPLATES) {
      expect(template.description.length).toBeGreaterThan(20)
    }
  })

  it('describes the two cards whose subtitles over-promised as what they now create', () => {
    // A subtitle is read twice, once on the gallery card and once as the instantiated
    // dashboard's own description line, so a clause naming a widget that never appears is a
    // promise broken on the screen that was supposed to keep it. `Review Progress` promised
    // reviewer workload, session scores and top-rated sessions; `Speaker Tracking` promised an
    // overdue list. `WIDGET_METRICS` has no reviewer, score or due-date aggregate, so all four
    // were unbuildable, and these two lines are pinned the way the transcribed strings above
    // are: reinstating a clause has to fail here rather than on a screenshot diff.
    expect(dashboardTemplate('review_progress')?.description).toBe(
      'Submissions still awaiting a decision, against every submission received.',
    )
    expect(dashboardTemplate('speaker_tracking')?.description).toBe(
      'Accepted speakers, confirmation status, outstanding tasks, and who is holding the most of them.',
    )
  })

  it('never promises an overdue or reviewer-workload widget on any card', () => {
    // The two phrases with no aggregate behind them anywhere in the enum, guarded across the
    // whole gallery so a new card cannot reintroduce either.
    for (const template of DASHBOARD_TEMPLATES) {
      expect(template.description.toLowerCase()).not.toContain('overdue')
      expect(template.description.toLowerCase()).not.toContain('reviewer workload')
    }
  })
})

describe('the two templates whose dashboards were captured', () => {
  it('creates ref 38s four Speaker Tracking widgets in order', () => {
    const template = dashboardTemplate('speaker_tracking')
    expect(template?.metrics).toEqual([
      'accepted_speakers',
      'outstanding_speaker_tasks',
      'speaker_confirmation_mix',
      'top_speakers_by_outstanding_tasks',
    ])
  })

  it('creates ref 39s four Submissions Pipeline widgets in order', () => {
    const template = dashboardTemplate('submissions_pipeline')
    expect(template?.metrics).toEqual([
      'total_submissions',
      'pending_review',
      'submissions_by_form',
      'submissions_by_track',
    ])
  })

  it('titles them exactly as refs 38 and 39 do', () => {
    const template = dashboardTemplate('speaker_tracking')
    expect(templateWidgets(template!).map((widget) => widget.title)).toEqual([
      'Accepted Speakers',
      'Outstanding Speaker Tasks',
      'Speaker Confirmation Mix',
      'Top Speakers by Outstanding Tasks',
    ])
  })
})

describe('templateWidgets', () => {
  it('numbers the widgets from zero so the grid order is the template order', () => {
    const template = dashboardTemplate('event_overview')
    expect(templateWidgets(template!).map((widget) => widget.order)).toEqual([0, 1, 2, 3, 4])
  })

  it('takes each widget shape from the catalogue rather than from the template', () => {
    for (const template of DASHBOARD_TEMPLATES) {
      for (const widget of templateWidgets(template)) {
        expect(widget.widgetType).toBe(widgetSpec(widget.metric).widgetType)
      }
    }
  })

  it('answers undefined for an unknown key so the action can refuse it', () => {
    expect(dashboardTemplate('not_a_template')).toBeUndefined()
  })
})

describe('DASHBOARD_MODES', () => {
  it('uses our own screenshots labels and not the current products', () => {
    // Ref 40: `Gallery`, `AI prompt`, `Build manually`. The live product's Add Widget modal now
    // reads `Gallery` / `From report` / `Build custom`; our screenshots win on presentation, and
    // dashboard-modes.ts records the divergence.
    //
    // `Build manually` is deliberately absent. It was a tab with nothing behind it on either
    // modal, and dashboard-modes.ts holds the reason it is dropped rather than kept as a stub.
    // Every mode left in this list has a pane that does something, which is what the assertion
    // now guards as well as the labels.
    expect(DASHBOARD_MODES.map((mode) => mode.label)).toEqual(['Gallery', 'AI prompt'])
  })
})
