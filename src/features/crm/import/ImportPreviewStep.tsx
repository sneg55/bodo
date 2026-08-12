'use client'

// Step 3: what the commit is going to do, row by row, before anything is written.
//
// The reference calls this a verification screen and highlights "any rows that may need
// additional attention" (docs/parity/external-references.md). Two kinds of attention are worth
// the organizer's here, and they are different events:
//
//   - a row that repeats an EARLIER ROW of the same file. `dedupeRows` will drop it whole, so
//     it is named with the row that lands instead, and it is the only case that loses data.
//   - a row that matches somebody already in the CRM. That is an update, it is normal, and it
//     is why an import can be re-run at all.
//
// Rows `mapRow` refused are listed separately rather than mixed in: they are not going to be
// attempted, and the reasons are the same words `planRow` uses, so the downloadable report
// after the commit reads the same whichever side refused a row.

import { AlertTriangleIcon } from 'lucide-react'
import { ScrollPanel } from '@/components/primitives/ScrollPanel'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { MappedRows, RowDisposition } from '@/features/crm/import/wizard-state'
import { previewCounts } from '@/features/crm/import/wizard-state'

export type ImportPreviewStepProps = {
  mapped: MappedRows
  rows: readonly RowDisposition[]
  /** Why the duplicate check could not run, if it could not. The import may still proceed. */
  problem: string | undefined
  checking: boolean
}

function DispositionCell({ row }: { row: RowDisposition }) {
  if (row.kind === 'repeat') {
    return <Badge variant="destructive">Repeats row {row.of}</Badge>
  }
  if (row.kind === 'update') {
    return <Badge variant="secondary">Update</Badge>
  }
  return <Badge variant="outline">New speaker</Badge>
}

export function ImportPreviewStep({ mapped, rows, problem, checking }: ImportPreviewStepProps) {
  const counts = previewCounts(rows)

  return (
    <div className="flex flex-col gap-4">
      {/* `tabular-nums`: the duplicate check lands after this line is already on screen and
          moves rows between create and update, so proportional numerals reflow the sentence
          under the organizer's eye. */}
      <p className="text-sm tabular-nums">
        {counts.create} to create, {counts.update} to update
        {counts.repeat === 0
          ? ''
          : `, ${counts.repeat} ${counts.repeat === 1 ? 'repeat' : 'repeats'} skipped`}
        {mapped.rejected.length === 0 ? '' : `, ${mapped.rejected.length} that cannot be read`}.
      </p>

      {problem === undefined ? null : (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Existing speakers could not be checked</AlertTitle>
          <AlertDescription className="flex flex-col gap-1">
            {/* Two paragraphs and not one sentence: the first is the server's own message and
                has its own punctuation, so running ours onto the end of it reads as a
                run-on. */}
            <span>{problem}</span>
            <span>
              Rows repeating an earlier row in this file are still flagged below. Nobody shown as
              new is known to be new, and the import matches on email itself, so going ahead cannot
              duplicate anyone.
            </span>
          </AlertDescription>
        </Alert>
      )}

      <ScrollPanel className="max-h-96 rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Row</TableHead>
              <TableHead>Email</TableHead>
              {/* What the mapping produced, so a file whose only name column was mapped to the
                  combined `Name` target shows the split before anything is written. */}
              <TableHead>Name</TableHead>
              <TableHead className="w-44">{checking ? 'Checking...' : 'What happens'}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.rowNumber}>
                <TableCell className="text-muted-foreground tabular-nums">
                  {row.rowNumber}
                </TableCell>
                <TableCell className="font-medium">{row.email}</TableCell>
                <TableCell className={row.name === undefined ? 'text-muted-foreground' : ''}>
                  {row.name ?? 'No name mapped'}
                </TableCell>
                <TableCell>
                  <DispositionCell row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollPanel>

      {mapped.rejected.length === 0 ? null : (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>
            {mapped.rejected.length} {mapped.rejected.length === 1 ? 'row' : 'rows'} will be skipped
          </AlertTitle>
          <AlertDescription>
            <ul className="list-inside list-disc">
              {mapped.rejected.map((row) => (
                <li key={row.rowNumber}>
                  Row {row.rowNumber}: {row.reason}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
