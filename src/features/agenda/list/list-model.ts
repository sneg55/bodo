import type { DataTableFilter, DataTableSort } from '@/components/primitives/data-table-types'
import {
  sessionFormatLabel,
  sessionLanguageLabel,
  sessionLevelLabel,
} from '@/features/submissions/session-vocabulary'

import type { AgendaSession } from '../types'

// The Agenda List's own filtering, sorting and CSV projection.
//
// There used to be an `AgendaSavedView` union here with three hardcoded entries
// ('all' | 'published' | 'unscheduled') and a `matchesSavedView` that filtered on
// `scheduleStatus`. It is gone: saved views are persisted rows now
// (`@/features/views/saved-view-model`, SavedViews in Airtable), and the three entries it
// stood in for are expressible as a stored filter on the `scheduleStatus` column, which
// `matchesFilter` below already evaluates. Keeping both would mean two things named "saved
// view" on one toolbar, only one of which persisted.

export type AgendaListOptions = {
  search: string
  draftsOnly: boolean
  sort: DataTableSort | null
  filters: readonly DataTableFilter[]
  timeZone: string
}

export function applyAgendaList(
  sessions: readonly AgendaSession[],
  options: AgendaListOptions,
): readonly AgendaSession[] {
  const search = options.search.trim().toLocaleLowerCase()
  const filtered = sessions.filter((session) => {
    if (options.draftsOnly && session.scheduleStatus === 'published') return false
    const values = agendaFieldValues(session, options.timeZone)
    if (search.length > 0 && ![...values.values()].some((value) => includes(value, search))) {
      return false
    }
    return options.filters.every((filter) => matchesFilter(values.get(filter.key) ?? '', filter))
  })

  if (options.sort === null) return filtered
  const { key, direction } = options.sort
  return [...filtered].sort((left, right) => {
    const leftValue = agendaFieldValues(left, options.timeZone).get(key) ?? ''
    const rightValue = agendaFieldValues(right, options.timeZone).get(key) ?? ''
    const order = leftValue.localeCompare(rightValue, undefined, { numeric: true })
    return direction === 'asc' ? order : -order
  })
}

export function agendaFieldValues(
  session: AgendaSession,
  timeZone: string,
): ReadonlyMap<string, string> {
  return new Map([
    ['code', session.code],
    ['title', session.title],
    ['status', session.status],
    ['source', session.sourceName],
    ['description', ''],
    // Labels, not stored keys: the column read `talk` where a person expects `Talk`.
    // `projectAgendaData` already labels these, so this is idempotent (`choiceLabel` passes
    // an unrecognised value, which a label is, straight through). It stays because this map
    // is the render, filter and CSV boundary, and a session reaching it from anywhere other
    // than that projection would otherwise print the key again.
    ['format', sessionFormatLabel(session.format) ?? ''],
    ['level', sessionLevelLabel(session.level) ?? ''],
    ['language', sessionLanguageLabel(session.language) ?? ''],
    ['track', session.track ?? ''],
    ['tags', session.tags.join(', ')],
    ['ceuCredits', session.ceuCredits?.toString() ?? ''],
    ['startsAt', formatDateTime(session.startsAt, timeZone)],
    ['endsAt', formatDateTime(session.endsAt, timeZone)],
    ['room', session.room ?? ''],
    ['scheduleStatus', session.scheduleStatus],
    ['capacity', session.capacity?.toString() ?? ''],
    ['location', session.location ?? ''],
    ['clientSessionId', session.clientSessionId ?? ''],
    ['notifiedAt', formatDateTime(session.notifiedAt, timeZone)],
    ['submittedAt', formatDateTime(session.submittedAt, timeZone)],
    ['ratings', ''],
    [
      'chairperson',
      session.participants
        .filter((participant) => participant.role === 'chairperson')
        .map((participant) => participant.name)
        .join(', '),
    ],
    ['participants', session.participants.map((participant) => participant.name).join(', ')],
  ])
}

export function agendaCsv(sessions: readonly AgendaSession[], timeZone: string): string {
  const keys = ['code', 'title', 'scheduleStatus', 'startsAt', 'endsAt', 'room', 'participants']
  const headings = [
    'ID',
    'Title',
    'Schedule Status',
    'Starts At',
    'Ends At',
    'Room',
    'Participants',
  ]
  const rows = sessions.map((session) => {
    const values = agendaFieldValues(session, timeZone)
    return keys.map((key) => csvCell(values.get(key) ?? '')).join(',')
  })
  return [headings.join(','), ...rows].join('\n')
}

function matchesFilter(value: string, filter: DataTableFilter): boolean {
  const haystack = value.toLocaleLowerCase()
  const needle = filter.value.trim().toLocaleLowerCase()
  if (filter.operator === 'is_empty') return value.length === 0
  if (filter.operator === 'is_not_empty') return value.length > 0
  if (filter.operator === 'is') return haystack === needle
  if (filter.operator === 'is_not') return haystack !== needle
  return haystack.includes(needle)
}

function includes(value: string, search: string): boolean {
  return value.toLocaleLowerCase().includes(search)
}

function formatDateTime(value: string | undefined, timeZone: string): string {
  if (value === undefined) return ''
  const instant = Date.parse(value)
  if (Number.isNaN(instant)) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(new Date(instant))
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}
