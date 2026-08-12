'use client'

// What one cell of the agenda List view renders, and the column list built from it.
//
// Split out of `AgendaListView.tsx` when that file reached its line budget, on the seam the
// Abstracts table already uses (`abstracts/abstracts-cells.tsx`): the view owns the table's
// STATE (search, saved views, selection, paging) and this owns how a row READS.
//
// The interesting cell is Schedule Status, which answers two different questions: what the
// organizer set, and whether a visitor can actually see it. See `public-agenda.ts` for the
// gate itself; the only rule that lives here is that both badges come from that module
// rather than being re-derived from `contentStatus` by eye.

import Link from 'next/link'
import type { ReactNode } from 'react'

import type { DataTableColumn } from '@/components/primitives/data-table-types'
import { StatusChip } from '@/components/primitives/StatusChip'
import { Badge } from '@/components/ui/badge'
import { SESSION_FIELDS } from '@/constants/fields'
import { cn } from '@/utils/cn'
import { ConflictBadge } from '../ConflictBadge'
import type { ConflictReport } from '../conflicts'
import {
  contentNoteLabel,
  type PublicVisibilityRow,
  publicContentNote,
  publicWithholding,
  withholdingLabel,
} from '../public-agenda'
import type { AgendaSession } from '../types'
import { agendaFieldValues } from './list-model'

/**
 * The public gate's view of one row.
 *
 * `calendarStatus` is supplied rather than carried on the session type: a cancelled session
 * never reaches this list. Exported because the view derives the gate's MODE from the same
 * shape, and the two must not describe a row differently.
 */
export function visibilityOf(session: AgendaSession): PublicVisibilityRow & { startsAt?: string } {
  return {
    status: session.status,
    scheduleStatus: session.scheduleStatus,
    calendarStatus: 'active',
    startsAt: session.startsAt,
    contentStatus: session.contentStatus,
  }
}

export function agendaColumns(
  eventId: string,
  timeZone: string,
  report: ConflictReport,
  requireContentApproval: boolean,
): readonly DataTableColumn<AgendaSession>[] {
  return SESSION_FIELDS.map((field) => ({
    key: field.key,
    cell: (session) => (
      <AgendaCell
        fieldKey={field.key}
        session={session}
        eventId={eventId}
        timeZone={timeZone}
        report={report}
        requireContentApproval={requireContentApproval}
      />
    ),
  }))
}

function AgendaCell({
  fieldKey,
  session,
  eventId,
  timeZone,
  report,
  requireContentApproval,
}: {
  fieldKey: string
  session: AgendaSession
  eventId: string
  timeZone: string
  report: ConflictReport
  /** The gate's mode for this agenda, derived once by the view above this one. */
  requireContentApproval: boolean
}): ReactNode {
  if (fieldKey === 'title') {
    return (
      <div className="flex min-w-56 items-center gap-2">
        {/* The title is a LINK, to the SAME route the Abstracts and Sessions tables send
            their titles to. It was a bare `<span>`, so this list showed twelve sessions and
            gave no way to open any of them: a click select-copied the text, and the record
            itself had no route in from here. The two surfaces list the same submissions, so
            a title that opens on one and does nothing on the other is the product
            disagreeing with itself about what a title is.

            `hover:underline` and nothing else, matching `abstracts-cells.tsx`: a control
            that navigates has to look like one before it is clicked. */}
        <Link
          href={`/admin/${eventId}/abstracts/${session.id}`}
          className="font-medium hover:underline"
        >
          {session.title}
        </Link>
        <ConflictBadge count={report.bySession.get(session.id)?.length ?? 0} compact />
      </div>
    )
  }
  if (fieldKey === 'status') return <StatusChip status={session.status} />
  if (fieldKey === 'source') return <Badge variant="secondary">{session.sourceName}</Badge>
  if (fieldKey === 'scheduleStatus')
    return <ScheduleStatusCell {...{ session, requireContentApproval }} />
  if (fieldKey === 'tags') {
    return (
      <div className="flex flex-wrap gap-1">
        {session.tags.map((tag) => (
          <Badge key={tag} variant="secondary">
            {tag}
          </Badge>
        ))}
      </div>
    )
  }
  const value = agendaFieldValues(session, timeZone).get(fieldKey) ?? ''
  const dateField = fieldKey === 'startsAt' || fieldKey === 'endsAt' || fieldKey === 'notifiedAt'
  return <span className={cn(dateField && 'whitespace-nowrap tabular-nums')}>{value}</span>
}

/**
 * Publication state, then whether it actually reached the public page, then the advisory.
 *
 * Three badges rather than one, because a row reading `Published` answers neither of the
 * other two questions and the only other way to ask them is to open /agenda/[slug] and
 * count:
 *
 *   - `Content not approved` (destructive): published, and a visitor cannot see it.
 *   - `Published, content not requested` (muted): published, live, and NOBODY HAS READ what
 *     will be presented. Not a withholding, which is exactly why it needs its own badge:
 *     `publicContentNote` returns it only for a row the gate is letting through, so an
 *     organizer can tell "live and unreviewed" from "held back".
 *
 * Both answers come from `public-agenda.ts` under the same `requireContentApproval` mode the
 * public read derives, so this cell cannot disagree with the page it describes.
 */
function ScheduleStatusCell({
  session,
  requireContentApproval,
}: {
  session: AgendaSession
  requireContentApproval: boolean
}): ReactNode {
  const row = visibilityOf(session)
  const gate = { requireContentApproval }
  const withheld = publicWithholding(row, gate)
  const note = publicContentNote(row, gate)

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge variant="outline">{scheduleStatusLabel(session.scheduleStatus)}</Badge>
      {withheld === 'content_not_approved' ? (
        <Badge variant="destructive">{withholdingLabel(withheld)}</Badge>
      ) : null}
      {note === undefined ? null : (
        <Badge variant="secondary" className="font-normal text-muted-foreground">
          {contentNoteLabel(note)}
        </Badge>
      )}
    </div>
  )
}

function scheduleStatusLabel(status: AgendaSession['scheduleStatus']): string {
  if (status === 'unscheduled') return 'Unscheduled'
  if (status === 'scheduled') return 'Scheduled'
  return 'Published'
}
