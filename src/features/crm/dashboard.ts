// The CRM dashboard's numbers, computed without a network.
//
// Org-wide rather than per event, which is the whole reason this surface exists next to
// `/admin/[eventId]` rather than inside it: the speaker database is the one part of the
// product that outlives a conference, so "how many people do we have, how many are confirmed,
// which tags are actually used, how many records look duplicated" are questions no event's
// dashboard can answer. Scope is still the viewer's own EventMemberships - there is no
// organization row in this schema to be "org-wide" against, and `CrmScope` is what every
// other CRM read intersects with.
//
// Every widget below is derived from data this product actually holds. There is no
// `createdAt` on a Speakers row, so there is deliberately no "speakers added over time"
// chart: the closest honest series is `invitedAt`, which is written when a portal invitation
// is sent, and it is labelled as invitations rather than as signups.
//
// Nothing here reads Airtable or the clock: the loader passes what it read, and the month
// series takes `now` as an argument, so the tests assert a fixed window.

import { SPEAKER_STATUSES, speakerStatusLabel } from '@/constants/status'
import type { DuplicateCluster } from '@/features/crm/duplicates'
import { speakerName } from '@/features/crm/speaker-rows'
import type { SpeakerInEvents } from '@/types/crm'
import type { RecordId, SpeakerTag } from '@/types/domain'

/** One row of a bar list: a label, its count, and its share of the whole as a percent. */
export type CrmMetricRow = {
  readonly id: string
  readonly label: string
  readonly count: number
  /** Rounded to a whole number, of `speakerCount` unless a widget says otherwise. */
  readonly percent: number
}

export type CrmMonthPoint = {
  /** `YYYY-MM`, so the series sorts as text and a test can name a bucket. */
  readonly month: string
  /** `Mar 2026`, rendered under the bar. */
  readonly label: string
  readonly count: number
}

export type CrmTopSpeaker = {
  readonly id: RecordId
  readonly name: string
  readonly sessionCount: number
  readonly eventCount: number
}

export type CrmDashboardView = {
  readonly speakerCount: number
  readonly eventCount: number
  /** Speaker-session pairs across the scope, which is what `sessionCounts` sums to. */
  readonly sessionCount: number
  /** People cast on at least one session. The rest are contacts, not presenters. */
  readonly activeSpeakerCount: number
  readonly byEvent: readonly CrmMetricRow[]
  readonly byStatus: readonly CrmMetricRow[]
  readonly byTag: readonly CrmMetricRow[]
  /** How complete the database is: the share carrying a headshot, a bio, a company. */
  readonly completeness: readonly CrmMetricRow[]
  /** Portal invitations per month over the trailing window. Empty when none were sent. */
  readonly invitesByMonth: readonly CrmMonthPoint[]
  readonly topSpeakers: readonly CrmTopSpeaker[]
  readonly duplicateClusters: number
  readonly duplicateRecords: number
}

export type CrmDashboardInput = {
  readonly speakers: readonly SpeakerInEvents[]
  readonly sessionCounts: ReadonlyMap<RecordId, number>
  readonly tagsBySpeaker: ReadonlyMap<RecordId, readonly SpeakerTag[]>
  /** Event id to name, for the by-event bars. An id with no name falls back to the id. */
  readonly eventNames: ReadonlyMap<RecordId, string>
  readonly clusters: readonly DuplicateCluster[]
  /** Now, injected so the trailing month window is assertable. */
  readonly now: Date
}

/** How many months the invitation series covers. A year reads as a year. */
export const INVITE_MONTHS = 12

/** How many rows the tag and top-speaker lists show before they stop being a list. */
const TOP_N = 8

function percentOf(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 100)
}

/** Counts to rows, largest first, ties broken by label so the order is stable across reads. */
function rankRows(
  counts: ReadonlyMap<string, number>,
  labelOf: (id: string) => string,
  total: number,
): readonly CrmMetricRow[] {
  return [...counts]
    .map(([id, count]) => ({ id, label: labelOf(id), count, percent: percentOf(count, total) }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
}

function countBy<T>(items: readonly T[], key: (item: T) => readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) {
    for (const id of key(item)) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

/**
 * Speakers per event, every event in scope, including the ones with none.
 *
 * The zero rows are kept on purpose: an event with no speakers is the single most actionable
 * thing this page can say, and a bar list built only from what has data would silently omit
 * exactly that case.
 */
function byEvent(input: CrmDashboardInput, total: number): readonly CrmMetricRow[] {
  const counts = countBy(input.speakers, (entry) => entry.eventIds)
  for (const eventId of input.eventNames.keys()) {
    if (!counts.has(eventId)) counts.set(eventId, 0)
  }
  return rankRows(counts, (id) => input.eventNames.get(id) ?? id, total)
}

/**
 * The status mix, over the fixed vocabulary rather than over what happens to be present.
 *
 * Every status is a row even at zero, because the five are a pipeline: "0 confirmed" is the
 * answer an organizer came for, and a list that drops empty stages reads as though the stage
 * does not exist. An absent `status` counts as `prospect`, matching how the roster groups it.
 */
function byStatus(input: CrmDashboardInput, total: number): readonly CrmMetricRow[] {
  const counts = new Map<string, number>(SPEAKER_STATUSES.map((status) => [status, 0]))
  for (const entry of input.speakers) {
    const status = entry.speaker.status ?? 'prospect'
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  // Not ranked: the pipeline's own order is the meaningful one, and sorting by size would
  // reorder the stages every time somebody is confirmed.
  return SPEAKER_STATUSES.map((status) => ({
    id: status,
    label: speakerStatusLabel(status),
    count: counts.get(status) ?? 0,
    percent: percentOf(counts.get(status) ?? 0, total),
  }))
}

/**
 * The tags actually in use, biggest first.
 *
 * Off the membership the directory already read rather than off the vocabulary, so a tag
 * nobody carries does not take a row: this widget answers "what do we label people with",
 * and an unused tag is an answer to a different question (whether the vocabulary needs
 * pruning) that the tag editor is the place for.
 */
function byTag(input: CrmDashboardInput, total: number): readonly CrmMetricRow[] {
  const names = new Map<string, string>()
  const counts = countBy(input.speakers, (entry) => {
    const tags = input.tagsBySpeaker.get(entry.speaker.id) ?? []
    for (const tag of tags) names.set(tag.id, tag.name)
    return tags.map((tag) => tag.id)
  })
  return rankRows(counts, (id) => names.get(id) ?? id, total).slice(0, TOP_N)
}

/**
 * What share of the database is usable for the things a speaker record is used FOR: an agenda
 * embed needs a headshot and a biography, and an organizer looking somebody up needs a company.
 *
 * Fixed order rather than ranked, so the three bars stay in the same places as the numbers
 * change and the page can be compared with itself week to week.
 */
function completeness(input: CrmDashboardInput, total: number): readonly CrmMetricRow[] {
  const has = (pick: (entry: SpeakerInEvents) => string | undefined) =>
    input.speakers.filter((entry) => (pick(entry) ?? '').trim().length > 0).length

  return [
    { id: 'headshot', label: 'Headshot', count: has((entry) => entry.speaker.headshotUrl) },
    { id: 'bio', label: 'Biography', count: has((entry) => entry.speaker.bio) },
    { id: 'company', label: 'Company', count: has((entry) => entry.speaker.company) },
  ].map((row) => ({ ...row, percent: percentOf(row.count, total) }))
}

/** `2026-03` from an ISO-ish timestamp, or undefined if it is not one. */
function monthKey(value: string): string | undefined {
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return undefined
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/**
 * Portal invitations per month across the trailing year, including the empty months.
 *
 * The empty months are the series: a bar chart that shows only the months with sends draws a
 * flat line out of a gap, which is the opposite of what happened. Bucketed in UTC because
 * `invitedAt` is stored as an instant and the alternative is a chart that moves when the
 * viewer's timezone does.
 *
 * Returns nothing at all when no invitation has ever been sent, so the page can render its
 * "no data yet" state instead of twelve empty bars claiming to be a chart.
 */
export function invitesByMonth(
  speakers: readonly SpeakerInEvents[],
  now: Date,
): readonly CrmMonthPoint[] {
  const counts = new Map<string, number>()
  for (const entry of speakers) {
    const invitedAt = entry.speaker.invitedAt
    const key = invitedAt === undefined ? undefined : monthKey(invitedAt)
    if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  if (counts.size === 0) return []

  const points: CrmMonthPoint[] = []
  for (let back = INVITE_MONTHS - 1; back >= 0; back -= 1) {
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    const month = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`
    points.push({
      month,
      label: `${MONTH_NAMES.at(at.getUTCMonth()) ?? ''} ${at.getUTCFullYear()}`,
      count: counts.get(month) ?? 0,
    })
  }
  return points
}

/** The people carrying the programme: most sessions first, then most events, then name. */
function topSpeakers(input: CrmDashboardInput): readonly CrmTopSpeaker[] {
  return input.speakers
    .map((entry) => ({
      id: entry.speaker.id,
      name: speakerName(entry.speaker),
      sessionCount: input.sessionCounts.get(entry.speaker.id) ?? 0,
      eventCount: entry.eventIds.length,
    }))
    .filter((row) => row.sessionCount > 0)
    .sort(
      (left, right) =>
        right.sessionCount - left.sessionCount ||
        right.eventCount - left.eventCount ||
        left.name.localeCompare(right.name),
    )
    .slice(0, TOP_N)
}

export function buildCrmDashboard(input: CrmDashboardInput): CrmDashboardView {
  const total = input.speakers.length
  const sessions = input.speakers.map((entry) => input.sessionCounts.get(entry.speaker.id) ?? 0)

  return {
    speakerCount: total,
    eventCount: input.eventNames.size,
    sessionCount: sessions.reduce((sum, count) => sum + count, 0),
    activeSpeakerCount: sessions.filter((count) => count > 0).length,
    byEvent: byEvent(input, total),
    byStatus: byStatus(input, total),
    byTag: byTag(input, total),
    completeness: completeness(input, total),
    invitesByMonth: invitesByMonth(input.speakers, input.now),
    topSpeakers: topSpeakers(input),
    duplicateClusters: input.clusters.length,
    duplicateRecords: input.clusters.reduce((sum, cluster) => sum + cluster.speakerIds.length, 0),
  }
}
