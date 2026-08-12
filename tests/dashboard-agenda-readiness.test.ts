// The Agenda sub-tab's four counts.
//
// Two orthogonal axes meet here, which is the whole reason this is tested: the review
// lifecycle says whether a session exists to schedule, and `ScheduleStatus` says where it is
// on the grid. A pending submission with a start time on it is the case that catches a count
// that conflates them, and a base gets into that state the moment somebody drags a talk onto
// the agenda before the decision is sent.
//
// The two strip-shared counts are asserted against `advisories()` itself rather than against
// literals, because agreeing with the sentence above the panel is the property, not the number.

import { describe, expect, it } from 'vitest'
import type { SubmissionStatus } from '@/constants/status'
import { agendaReadiness } from '@/features/dashboard/agenda-readiness'
import { advisories } from '@/features/dashboard/home-view'

type Row = {
  status: SubmissionStatus
  startsAt?: string
  scheduleStatus: 'unscheduled' | 'scheduled' | 'published'
}

const row = (over: Partial<Row> = {}): Row => ({
  status: 'pending',
  scheduleStatus: 'unscheduled',
  ...over,
})

const AT = '2026-10-12T17:00:00.000Z'

describe('agendaReadiness', () => {
  it('counts accepted sessions only, split by whether they hold a time slot', () => {
    const view = agendaReadiness([
      row({ status: 'accepted', startsAt: AT, scheduleStatus: 'published' }),
      row({ status: 'accepted', startsAt: AT, scheduleStatus: 'scheduled' }),
      row({ status: 'accepted' }),
      row({ startsAt: AT, scheduleStatus: 'scheduled' }),
      row({ status: 'draft' }),
    ])

    expect(view.accepted).toBe(3)
    expect(view.slotted).toBe(2)
    expect(view.awaitingSlot).toBe(1)
    // Slotted and awaiting a slot partition the accepted sessions, so the panel can never
    // show a session in both boxes or in neither.
    expect(view.slotted + view.awaitingSlot).toBe(view.accepted)
  })

  it('counts what is awaiting publication over every submission, as the strip does', () => {
    const view = agendaReadiness([
      row({ status: 'accepted', startsAt: AT, scheduleStatus: 'scheduled' }),
      // On somebody's grid before its decision was sent. The strip counts it, so does this.
      row({ startsAt: AT, scheduleStatus: 'scheduled' }),
      row({ status: 'accepted', startsAt: AT, scheduleStatus: 'published' }),
    ])

    expect(view.awaitingPublication).toBe(2)
  })

  it('agrees with the advisory strip on both counts the two of them share', () => {
    const submissions = [
      row({ status: 'accepted', startsAt: AT, scheduleStatus: 'scheduled' }),
      row({ status: 'accepted' }),
      row({ status: 'accepted' }),
      row({ startsAt: AT, scheduleStatus: 'scheduled' }),
    ]
    const view = agendaReadiness(submissions)
    const strip = advisories({ submissions, eventHref: (path) => path })
    const text = (id: string) => strip.find((entry) => entry.id === id)?.text ?? ''

    expect(text('unslotted')).toContain(`${view.awaitingSlot} accepted`)
    expect(text('unpublished')).toContain(`${view.awaitingPublication} scheduled`)
  })

  it('reports zeroes rather than throwing on an event with nothing accepted', () => {
    expect(agendaReadiness([row(), row({ status: 'draft' })])).toEqual({
      accepted: 0,
      slotted: 0,
      awaitingSlot: 0,
      awaitingPublication: 0,
    })
  })
})
