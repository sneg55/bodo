// One row per (speaker, requested document): the pair the deliverables criterion asks for.
//
// `features/file-requests/delivery.ts` answers a different question and keeps answering it: it
// folds the same data down to ONE row per speaker with a delivered fraction. That aggregate is
// what an organizer reads to see how the roster is doing, and it cannot say "this speaker,
// this request, delivered or not, due when", because a speaker owes several documents with
// several deadlines and a single row has one of each. So the pair is computed here rather than
// by loosening that function into something with a mode flag.
//
// The dedup rule is SHARED, not reimplemented: `dedupeRequestAssignments` is the same tuple
// key the request card and the portal list use, so the pair table, the card and the aggregate
// cannot disagree about how many documents exist. Airtable has no unique constraint, so a row
// added in the base by hand would otherwise appear twice here and inflate every count.
//
// The Columns, Sort and Filter panes over these rows live next door in deliverable-query.ts.
//
// Pure, and tested in tests/files-deliverables.test.ts.

import { dedupeRequestAssignments } from '@/features/file-requests/plan'
import { formatDue } from '@/features/portal/task-view'
import { type SpeakerScope, speakerDisplayName } from '@/features/tasks/scope'
import type { FileRequestItem } from '@/services/airtable/reads-requests'
import type { RecordId } from '@/types/domain'

/** Three states and not two: an outstanding document past its deadline is the one to chase. */
export type DeliverableState = 'received' | 'outstanding' | 'overdue'

export function deliverableStateLabel(state: DeliverableState): string {
  switch (state) {
    case 'received':
      return 'Delivered'
    case 'overdue':
      return 'Overdue'
    case 'outstanding':
      return 'Outstanding'
  }
}

export type DeliverableRow = {
  /** The uniqueness tuple, so a row is addressable and its React key is stable. */
  readonly id: string
  readonly speakerId: RecordId
  readonly speakerName: string
  readonly email: string
  readonly fileRequestId: RecordId
  /** The request's own title, undecorated. `Signed speaker release`. */
  readonly title: string
  /** `SESS-4`, only for a submission-scoped request, which is owed once per session. */
  readonly sessionCode?: string
  readonly required: boolean
  readonly state: DeliverableState
  readonly statusLabel: string
  /** The raw instant, for ordering and for the overdue test. */
  readonly dueAt?: string
  /** `Mar 3, 2026`, in the event's timezone. Absent when the request has no deadline. */
  readonly dueDate?: string
  readonly receivedAt?: string
  readonly receivedDate?: string
  /** This person's whole delivered fraction, `1/3`, so a pair row still carries their progress. */
  readonly speakerLabel: string
  readonly speakerPercent: number
}

export function deliverableRows(input: {
  scopes: readonly SpeakerScope[]
  items: readonly FileRequestItem[]
  /** The event's timezone, so a deadline reads the same here, on the card and in the portal. */
  timeZone: string
  /** Submission id to its `SESS-n` code. Without it three decks read as one repeated title. */
  codeBySubmission?: ReadonlyMap<RecordId, string>
  /** One instant for the whole table, so two rows cannot disagree about what is overdue. */
  now: string
}): readonly DeliverableRow[] {
  const roster = new Map(input.scopes.map((scope) => [scope.speaker.id, scope]))
  // An assignment pointing outside the accepted roster is dropped, exactly as the aggregate
  // drops it: there is nobody for it to be outstanding for.
  const kept = dedupeRequestAssignments(input.items).filter((item) =>
    roster.has(item.assignment.speakerId),
  )
  const totals = perSpeakerTotals(kept)
  const nowMs = Date.parse(input.now)

  const rows = kept.flatMap((item) => {
    const scope = roster.get(item.assignment.speakerId)
    if (scope === undefined) return []
    const tally = totals.get(scope.speaker.id) ?? { requested: 0, received: 0 }
    return [
      toRow({ item, scope, tally, timeZone: input.timeZone, nowMs, codes: input.codeBySubmission }),
    ]
  })

  // Soonest deadline first with the undated last, then by person, then by title: the order an
  // organizer chases in. The table can be re-sorted, and this is what it opens on.
  return [...rows].sort(byDueThenSpeaker)
}

function toRow(input: {
  item: FileRequestItem
  scope: SpeakerScope
  tally: { requested: number; received: number }
  timeZone: string
  nowMs: number
  codes?: ReadonlyMap<RecordId, string>
}): DeliverableRow {
  const { item, scope, tally } = input
  const received = item.assignment.status === 'received'
  const dueAt = item.request.dueAt
  const receivedAt = item.assignment.receivedAt
  const dueDate = dayLabel(dueAt, input.timeZone)
  const receivedDate = dayLabel(receivedAt, input.timeZone)
  const state: DeliverableState = received
    ? 'received'
    : isPast(dueAt, input.nowMs)
      ? 'overdue'
      : 'outstanding'

  return {
    id: `${item.assignment.speakerId}:${item.request.id}:${item.assignment.submissionId ?? ''}`,
    speakerId: scope.speaker.id,
    speakerName: speakerDisplayName(scope.speaker),
    email: scope.speaker.email.trim(),
    fileRequestId: item.request.id,
    title: item.request.title,
    ...codeOf(item, input.codes),
    required: item.request.required,
    state,
    statusLabel: deliverableStateLabel(state),
    ...(dueAt === undefined ? {} : { dueAt }),
    ...(dueDate === undefined ? {} : { dueDate }),
    ...(receivedAt === undefined ? {} : { receivedAt }),
    ...(receivedDate === undefined ? {} : { receivedDate }),
    speakerLabel: `${String(tally.received)}/${String(tally.requested)}`,
    speakerPercent:
      tally.requested === 0 ? 0 : Math.round((tally.received / tally.requested) * 100),
  }
}

function isPast(dueAt: string | undefined, nowMs: number): boolean {
  if (dueAt === undefined) return false
  const due = Date.parse(dueAt)
  return !Number.isNaN(due) && due < nowMs
}

function codeOf(
  item: FileRequestItem,
  codes?: ReadonlyMap<RecordId, string>,
): { sessionCode?: string } {
  const submissionId = item.assignment.submissionId
  if (submissionId === undefined) return {}
  const code = codes?.get(submissionId)
  return code === undefined ? {} : { sessionCode: code }
}

/**
 * `Mar 3, 2026` from the one date formatter this product has.
 *
 * `formatDue` owns the timezone handling and the month/day/year shape, and it prefixes `Due `
 * because its callers put the string inside a sentence. A column headed `Due` that reads
 * `Due Mar 3, 2026` says it twice, so the prefix is stripped here rather than a second
 * `Intl.DateTimeFormat` being declared that could drift from it.
 */
function dayLabel(iso: string | undefined, timeZone: string): string | undefined {
  return formatDue(iso, timeZone)?.replace(/^Due /, '')
}

function perSpeakerTotals(
  items: readonly FileRequestItem[],
): ReadonlyMap<RecordId, { requested: number; received: number }> {
  const totals = new Map<RecordId, { requested: number; received: number }>()
  for (const item of items) {
    const tally = totals.get(item.assignment.speakerId) ?? { requested: 0, received: 0 }
    tally.requested += 1
    if (item.assignment.status === 'received') tally.received += 1
    totals.set(item.assignment.speakerId, tally)
  }
  return totals
}

function byDueThenSpeaker(left: DeliverableRow, right: DeliverableRow): number {
  if (left.dueAt !== right.dueAt) {
    if (left.dueAt === undefined) return 1
    if (right.dueAt === undefined) return -1
    return left.dueAt.localeCompare(right.dueAt)
  }
  if (left.speakerName !== right.speakerName) {
    return left.speakerName.localeCompare(right.speakerName)
  }
  return left.title.localeCompare(right.title)
}

/** What one row's Deliverable cell reads: the title, with its session when it has one. */
export function deliverableTitle(row: DeliverableRow): string {
  return row.sessionCode === undefined ? row.title : `${row.title} (${row.sessionCode})`
}

export const DELIVERABLE_TABS = ['all', 'outstanding', 'overdue', 'received'] as const
export type DeliverableTab = (typeof DELIVERABLE_TABS)[number]

function tabLabel(tab: DeliverableTab): string {
  switch (tab) {
    case 'all':
      return 'All deliverables'
    case 'outstanding':
      return 'Outstanding'
    case 'overdue':
      return 'Overdue'
    case 'received':
      return 'Delivered'
  }
}

/** `overdue` is a SUBSET of outstanding, so those two counts deliberately overlap. */
export function keepForTab(row: DeliverableRow, tab: DeliverableTab): boolean {
  if (tab === 'all') return true
  if (tab === 'outstanding') return row.state !== 'received'
  if (tab === 'overdue') return row.state === 'overdue'
  return row.state === 'received'
}

export function deliverableTabs(
  rows: readonly DeliverableRow[],
): readonly { id: DeliverableTab; label: string; count: number }[] {
  return DELIVERABLE_TABS.map((tab) => ({
    id: tab,
    label: tabLabel(tab),
    count: rows.filter((row) => keepForTab(row, tab)).length,
  }))
}
