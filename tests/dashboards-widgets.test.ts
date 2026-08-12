// What the eight widget metrics count, refs 38 and 39.
//
// The traps under test are the ones a card cannot show you: whether the untracked submissions
// landed in the `(none)` bucket, whether a speaker with two confirmation tasks was counted twice,
// and the difference between a widget reading 0 and a widget with nothing to draw.

import { describe, expect, it } from 'vitest'

import type { WidgetInputs, WidgetSubmission, WidgetTask } from '@/features/dashboard/widget-views'
import { barTicks, NO_BUCKET_LABEL, widgetView } from '@/features/dashboard/widget-views'

const EMPTY: WidgetInputs = { submissions: [], forms: [], tracks: [], tasks: [] }

const speaker = (id: string, name: string) => ({ speakerId: id, role: 'speaker', name }) as const

const submission = (over: Partial<WidgetSubmission> = {}): WidgetSubmission => ({
  status: 'pending',
  participants: [],
  ...over,
})

const task = (over: Partial<WidgetTask> = {}): WidgetTask => ({
  speakerId: 'spk1',
  status: 'pending',
  kind: 'upload',
  ...over,
})

describe('the stat metrics', () => {
  it('counts every submission for TOTAL SUBMISSIONS, drafts included', () => {
    const inputs = {
      ...EMPTY,
      submissions: [
        submission(),
        submission({ status: 'draft' }),
        submission({ status: 'accepted' }),
      ],
    }

    expect(widgetView('total_submissions', inputs)).toEqual({ kind: 'stat', value: 3 })
  })

  it('counts only awaiting-decision rows for PENDING REVIEW', () => {
    const inputs = {
      ...EMPTY,
      submissions: [submission(), submission(), submission({ status: 'accepted' })],
    }

    expect(widgetView('pending_review', inputs)).toEqual({ kind: 'stat', value: 2 })
  })

  it('deduplicates people for ACCEPTED SPEAKERS', () => {
    // The same speaker on two accepted talks is one accepted speaker, which is the rule
    // `roles.ts` already owns for ref 34's KPI tile. Reused here so the tile and the widget
    // cannot disagree.
    const inputs = {
      ...EMPTY,
      submissions: [
        submission({ status: 'accepted', participants: [speaker('spk1', 'A Chen')] }),
        submission({ status: 'accepted', participants: [speaker('spk1', 'A Chen')] }),
      ],
    }

    expect(widgetView('accepted_speakers', inputs)).toEqual({ kind: 'stat', value: 1 })
  })

  it('counts assignments and not people for OUTSTANDING SPEAKER TASKS', () => {
    const inputs = {
      ...EMPTY,
      tasks: [task(), task(), task({ status: 'done' }), task({ speakerId: 'spk2' })],
    }

    expect(widgetView('outstanding_speaker_tasks', inputs)).toEqual({ kind: 'stat', value: 3 })
  })

  it('reads zero rather than No data, which is what ref 38 shows', () => {
    expect(widgetView('accepted_speakers', EMPTY)).toEqual({ kind: 'stat', value: 0 })
    expect(widgetView('total_submissions', EMPTY)).toEqual({ kind: 'stat', value: 0 })
  })
})

describe('SPEAKER CONFIRMATION MIX', () => {
  it('splits the speakers who were asked into confirmed and unconfirmed', () => {
    const inputs = {
      ...EMPTY,
      tasks: [
        task({ speakerId: 'spk1', kind: 'confirm', status: 'done' }),
        task({ speakerId: 'spk2', kind: 'confirm' }),
        task({ speakerId: 'spk3', kind: 'confirm' }),
        // Not a confirmation, so it puts nobody in the mix.
        task({ speakerId: 'spk4', kind: 'upload' }),
      ],
    }

    expect(widgetView('speaker_confirmation_mix', inputs)).toEqual({
      kind: 'donut',
      // The labels name the TASK sense on purpose: "confirmed" means three different things
      // across this build and bare `Confirmed` here read as the roster's Speaker status. See
      // `confirmationMix`.
      slices: [
        { id: 'confirmed', label: 'Confirmation task done', value: 1 },
        { id: 'unconfirmed', label: 'Confirmation task outstanding', value: 2 },
      ],
      centreValue: 1,
      centreCaption: 'tasks done',
    })
  })

  it('counts a speaker with two confirmation tasks once, confirmed if either is done', () => {
    const inputs = {
      ...EMPTY,
      tasks: [
        task({ speakerId: 'spk1', kind: 'confirm', status: 'pending' }),
        task({ speakerId: 'spk1', kind: 'confirm', status: 'done' }),
      ],
    }

    expect(widgetView('speaker_confirmation_mix', inputs)).toEqual({
      kind: 'donut',
      slices: [
        { id: 'confirmed', label: 'Confirmation task done', value: 1 },
        { id: 'unconfirmed', label: 'Confirmation task outstanding', value: 0 },
      ],
      centreValue: 1,
      centreCaption: 'tasks done',
    })
  })

  it('is No data when nobody has been asked to confirm, as in ref 38', () => {
    expect(widgetView('speaker_confirmation_mix', EMPTY)).toEqual({ kind: 'empty' })
  })
})

describe('TOP SPEAKERS BY OUTSTANDING TASKS', () => {
  it('ranks by open tasks, breaking ties on the name', () => {
    const inputs: WidgetInputs = {
      ...EMPTY,
      submissions: [
        submission({
          participants: [
            speaker('spk1', 'A Chen'),
            speaker('spk2', 'M Patel'),
            speaker('spk3', 'J Rivera'),
          ],
        }),
      ],
      tasks: [
        task({ speakerId: 'spk1' }),
        task({ speakerId: 'spk1' }),
        task({ speakerId: 'spk2' }),
        task({ speakerId: 'spk3' }),
        // Done, so it is not outstanding and does not move anybody up the list.
        task({ speakerId: 'spk3', status: 'done' }),
      ],
    }

    expect(widgetView('top_speakers_by_outstanding_tasks', inputs)).toEqual({
      kind: 'top_list',
      rows: [
        { id: 'spk1', label: 'A Chen', value: 2 },
        { id: 'spk3', label: 'J Rivera', value: 1 },
        { id: 'spk2', label: 'M Patel', value: 1 },
      ],
    })
  })

  it('shows at most six rows, which is what ref 40s thumbnail lists', () => {
    const inputs: WidgetInputs = {
      ...EMPTY,
      tasks: Array.from({ length: 9 }, (_, index) => task({ speakerId: `spk${index}` })),
    }
    const view = widgetView('top_speakers_by_outstanding_tasks', inputs)

    expect(view.kind === 'top_list' ? view.rows.length : 0).toBe(6)
  })

  it('keeps a task whose speaker is on no submission, so the two task widgets agree', () => {
    const inputs = { ...EMPTY, tasks: [task({ speakerId: 'ghost' })] }

    expect(widgetView('top_speakers_by_outstanding_tasks', inputs)).toEqual({
      kind: 'top_list',
      rows: [{ id: 'ghost', label: NO_BUCKET_LABEL, value: 1 }],
    })
    expect(widgetView('outstanding_speaker_tasks', inputs)).toEqual({ kind: 'stat', value: 1 })
  })

  it('is No data with no open tasks', () => {
    expect(widgetView('top_speakers_by_outstanding_tasks', EMPTY)).toEqual({ kind: 'empty' })
  })
})

describe('SUBMISSIONS BY FORM and BY TRACK', () => {
  it('buckets the formless rows under (none), which is ref 39s x-axis label', () => {
    const inputs: WidgetInputs = {
      ...EMPTY,
      forms: [{ id: 'frm1', name: 'Session Submission Form #2' }],
      submissions: [submission({ formId: 'frm1' }), submission(), submission()],
    }

    expect(widgetView('submissions_by_form', inputs)).toEqual({
      kind: 'bar',
      bars: [
        { id: 'frm1', label: 'Session Submission Form #2', value: 1 },
        { id: 'none', label: '(none)', value: 2 },
      ],
    })
  })

  it('leaves out a form nobody submitted to rather than drawing a zero bar', () => {
    // Ref 39's chart has ONE bar on an event holding three forms (ref 35).
    const inputs: WidgetInputs = {
      ...EMPTY,
      forms: [
        { id: 'frm1', name: 'Form A' },
        { id: 'frm2', name: 'Form B' },
      ],
      submissions: [submission({ formId: 'frm2' })],
    }

    expect(widgetView('submissions_by_form', inputs)).toEqual({
      kind: 'bar',
      bars: [{ id: 'frm2', label: 'Form B', value: 1 }],
    })
  })

  it('folds a submission pointing at a deleted form into (none)', () => {
    const inputs: WidgetInputs = {
      ...EMPTY,
      forms: [{ id: 'frm1', name: 'Form A' }],
      submissions: [submission({ formId: 'gone' }), submission()],
    }

    expect(widgetView('submissions_by_form', inputs)).toEqual({
      kind: 'bar',
      bars: [{ id: 'none', label: '(none)', value: 2 }],
    })
  })

  it('keeps (none) last so it cannot be read as a track', () => {
    const inputs: WidgetInputs = {
      ...EMPTY,
      tracks: [
        { id: 'trk1', name: 'AI' },
        { id: 'trk2', name: 'Ops' },
      ],
      submissions: [submission(), submission({ trackId: 'trk2' }), submission({ trackId: 'trk1' })],
    }

    expect(widgetView('submissions_by_track', inputs)).toEqual({
      kind: 'bar',
      bars: [
        { id: 'trk1', label: 'AI', value: 1 },
        { id: 'trk2', label: 'Ops', value: 1 },
        { id: 'none', label: '(none)', value: 1 },
      ],
    })
  })

  it('is No data with no submissions at all', () => {
    expect(widgetView('submissions_by_form', EMPTY)).toEqual({ kind: 'empty' })
    expect(widgetView('submissions_by_track', EMPTY)).toEqual({ kind: 'empty' })
  })
})

describe('barTicks', () => {
  it('gives ref 39s first axis: 2, 1.5, 1, 0.5, 0', () => {
    expect(barTicks(2).map((tick) => tick.label)).toEqual(['2', '1.5', '1', '0.5', '0'])
  })

  it('gives ref 39s second axis: 1, 0.75, 0.5, 0.25, 0', () => {
    expect(barTicks(1).map((tick) => tick.label)).toEqual(['1', '0.75', '0.5', '0.25', '0'])
  })

  it('does not print floating point noise', () => {
    // 7 * 0.75 is 5.25 exactly, but 0.1 * 3 is not 0.3, and an axis is where that shows.
    expect(barTicks(7).map((tick) => tick.label)).toEqual(['7', '5.25', '3.5', '1.75', '0'])
    expect(barTicks(0).map((tick) => tick.label)).toEqual(['0', '0', '0', '0', '0'])
  })
})
