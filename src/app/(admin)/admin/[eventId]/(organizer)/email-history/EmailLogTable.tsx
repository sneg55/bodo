'use client'

// The email history table.
//
// The status column carries the WHY as well as the what. A failure with no reason on it is
// the state this page exists to end: an organizer who can see that an acceptance email
// failed and not why has learned only that they need somebody with Airtable access.
//
// THE REASON IS AN EXPANDING ROW, NOT A TOOLTIP, and that is the correction worth recording
// because the tooltip it replaced worked. A hover target is the wrong control for diagnostic
// text at this scale: it shows one row at a time, so nothing about forty dead rows can be
// compared; the text cannot be selected, so it cannot be pasted into a support thread or a
// DNS record; there is no hover on a touch device; and an eval run reported the control as
// dead on exactly the evidence a working hover-only tooltip produces, which is a control
// that answers nothing to anyone reading the page rather than pointing at it. `Show all
// reasons` is the half that matters most: 42 failures with one reason between them is a
// misconfigured sending domain, and that is only visible when they are read together.

import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { OutboxStatus } from '@/constants/status'
import { type EmailLogRow, type EmailLogView, emailSourceLabel } from '@/features/comms/log'

/**
 * `dead` is the one worth a distinct look: it means the drain stopped retrying, so nobody
 * is going to receive that message unless a person does something. `failed` is still in
 * play, which is why the two are not collapsed.
 */
const STATUS_VARIANT: ReadonlyMap<OutboxStatus, 'default' | 'secondary' | 'destructive'> = new Map([
  ['sent', 'default'],
  ['queued', 'secondary'],
  ['sending', 'secondary'],
  ['failed', 'destructive'],
  ['dead', 'destructive'],
])

/** Every column, so an expanded reason spans the row it belongs to rather than one cell. */
const COLUMN_COUNT = 5

export function EmailLogTable({ view }: { view: EmailLogView }) {
  // The ids whose reason is open. A set rather than one id, because comparing two failures
  // is the thing this exists for, and rather than a boolean per row, because "open all" has
  // to be expressible as one state change.
  const [openReasons, setOpenReasons] = useState<ReadonlySet<string>>(new Set())

  if (view.rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No email has been queued for this event yet. Submitting a proposal, notifying a decision, or
        reminding a reviewer will each put a row here.
      </p>
    )
  }

  const failedIds = view.rows.filter((row) => row.lastError !== undefined).map((row) => row.id)
  const allOpen = failedIds.length > 0 && failedIds.every((id) => openReasons.has(id))

  function toggleRow(id: string): void {
    setOpenReasons((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {[...Object.entries(view.counts)]
          // Only the states this event has actually reached, so a healthy log is not four
          // zeroes and a number.
          .filter(([, count]) => count > 0)
          .map(([status, count]) => (
            <Badge key={status} variant="secondary">
              {count} {status}
            </Badge>
          ))}

        {view.failureCount === 0 ? null : (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => {
              setOpenReasons(allOpen ? new Set() : new Set(failedIds))
            }}
          >
            {allOpen ? 'Hide all reasons' : `Show all ${String(view.failureCount)} failure reasons`}
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>To</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>When</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.rows.map((row) => (
              <LogRows
                key={row.id}
                row={row}
                open={openReasons.has(row.id)}
                onToggle={() => {
                  toggleRow(row.id)
                }}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

/**
 * One log row, plus the reason row underneath it when that is open.
 *
 * A fragment of two `TableRow`s rather than a nested table: the reason has to line up under
 * the row it explains and stay readable at full width, and a second table inside a cell
 * would give it its own column widths.
 */
function LogRows({
  row,
  open,
  onToggle,
}: {
  row: EmailLogRow
  open: boolean
  onToggle: () => void
}) {
  return (
    <>
      <TableRow>
        <TableCell className="whitespace-nowrap">{row.toEmail}</TableCell>
        <TableCell className="font-medium">{row.subject}</TableCell>
        <TableCell className="whitespace-nowrap">{emailSourceLabel(row.source)}</TableCell>
        <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
          {row.whenText}
        </TableCell>
        <TableCell>
          <span className="flex items-center gap-1.5">
            <Badge variant={STATUS_VARIANT.get(row.status) ?? 'secondary'}>{row.status}</Badge>
            {row.attempts > 1 ? (
              <span className="text-xs tabular-nums text-muted-foreground">
                {row.attempts} attempts
              </span>
            ) : null}
            {row.lastError === undefined ? null : (
              <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={onToggle}>
                {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
                Why
              </Button>
            )}
          </span>
        </TableCell>
      </TableRow>

      {open && row.lastError !== undefined ? (
        <TableRow className="hover:bg-transparent">
          {/* `whitespace-normal` because `TableCell` sets `whitespace-nowrap`, which a cell
              holding a paragraph must undo: without it the reason renders as one long line
              that widens the table and is read by scrolling sideways, which defeats the
              point of opening seven of them at once. */}
          <TableCell colSpan={COLUMN_COUNT} className="pt-0 whitespace-normal">
            {/* `select-text` and `break-words` rather than a truncating cell: the provider's
                own words are what gets pasted into a support thread, so they have to be
                selectable and complete. */}
            <p className="max-w-2xl rounded-lg bg-muted px-3 py-2 font-mono text-xs break-words select-text">
              {row.lastError}
            </p>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}
