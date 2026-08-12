import { describe, expect, it } from 'vitest'

import { agendaCsv, applyAgendaList } from '@/features/agenda/list/list-model'
import { reduceAgendaSessions } from '@/features/agenda/optimistic'
import type { AgendaSession } from '@/features/agenda/types'

function session(patch: Partial<AgendaSession> & { id: string; title: string }): AgendaSession {
  return {
    code: patch.id,
    status: 'accepted',
    source: 'manual',
    sourceName: 'Manual',
    tags: [],
    scheduleStatus: 'unscheduled',
    contentStatus: 'not_submitted',
    participants: [],
    ...patch,
  }
}

const SESSIONS = [
  session({
    id: 's1',
    title: 'Agent evaluation',
    scheduleStatus: 'published',
    roomId: 'r1',
    room: 'Main Stage',
    startsAt: '2026-10-12T16:00:00.000Z',
    endsAt: '2026-10-12T16:30:00.000Z',
    participants: [{ id: 'p1', name: 'Ada Okafor' }],
  }),
  session({ id: 's2', title: 'Retrieval systems', participants: [{ id: 'p2', name: 'Chen Wei' }] }),
]

const BASE_OPTIONS = {
  search: '',
  draftsOnly: false,
  sort: null,
  filters: [],
  timeZone: 'America/Los_Angeles',
}

describe('agenda list model', () => {
  it('searches participant names as part of the session catalog', () => {
    const rows = applyAgendaList(SESSIONS, { ...BASE_OPTIONS, search: 'chen' })
    expect(rows.map((row) => row.id)).toEqual(['s2'])
  })

  it('treats Drafts as the admin-only unpublished schedule view', () => {
    const rows = applyAgendaList(SESSIONS, { ...BASE_OPTIONS, draftsOnly: true })
    expect(rows.map((row) => row.id)).toEqual(['s2'])
  })

  it('applies field-catalog filters without dynamic object access', () => {
    const rows = applyAgendaList(SESSIONS, {
      ...BASE_OPTIONS,
      filters: [{ id: 'f1', key: 'room', operator: 'contains', value: 'main' }],
    })
    expect(rows.map((row) => row.id)).toEqual(['s1'])
  })

  it('expresses what the three hardcoded saved views used to do as a stored filter', () => {
    // The old `savedView: 'published' | 'unscheduled'` union is gone: a persisted view
    // carries a filter on the `scheduleStatus` column instead, and this is the assertion
    // that the column is filterable so nothing was lost in the swap.
    const published = applyAgendaList(SESSIONS, {
      ...BASE_OPTIONS,
      filters: [{ id: 'f1', key: 'scheduleStatus', operator: 'is', value: 'published' }],
    })
    expect(published.map((row) => row.id)).toEqual(['s1'])

    const unscheduled = applyAgendaList(SESSIONS, {
      ...BASE_OPTIONS,
      filters: [{ id: 'f1', key: 'scheduleStatus', operator: 'is', value: 'unscheduled' }],
    })
    expect(unscheduled.map((row) => row.id)).toEqual(['s2'])
  })

  it('escapes quotes in CSV exports', () => {
    const csv = agendaCsv([session({ id: 's3', title: 'Agents, "live"' })], 'UTC')
    expect(csv).toContain('"Agents, ""live"""')
  })
})

describe('agenda optimistic reducer', () => {
  it('moves a tray card at pointer-up', () => {
    const next = reduceAgendaSessions(SESSIONS, {
      type: 'schedule',
      scheduleStatus: 'scheduled',
      change: {
        submissionId: 's2',
        roomId: 'r1',
        startsAt: '2026-10-12T17:00:00.000Z',
        endsAt: '2026-10-12T17:30:00.000Z',
      },
    })
    expect(next.find((row) => row.id === 's2')).toMatchObject({
      roomId: 'r1',
      scheduleStatus: 'scheduled',
    })
  })

  it('reverses publication without clearing the scheduled slot', () => {
    const next = reduceAgendaSessions(SESSIONS, {
      type: 'publication',
      submissionIds: ['s1'],
      published: false,
    })
    expect(next.find((row) => row.id === 's1')).toMatchObject({
      roomId: 'r1',
      scheduleStatus: 'scheduled',
    })
  })
})
