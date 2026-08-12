'use client'

// What the import is going to do, row by row, before anything is written.
//
// Split from `SpeakerImportSheet.tsx` for the file-size limit, and it is the half that answers
// the question the old preview could not: the sheet said "3 ready to import" and then "Imported
// 3 speakers", which is the same sentence whether three people were added or three existing
// profiles were rewritten. An eval run hit exactly that and could not tell, from the app, that
// the importer creates anybody at all.
//
// The vocabulary is the CRM import wizard's, verbatim - `N to create, N to update`, and the
// `New speaker` / `Update` badges - because two importers in one product describing the same
// outcome in two dialects is a familiarity cost with nothing behind it.
//
// UNCHECKED IS SAID, NOT GUESSED. Until the server has answered which addresses already exist,
// the rows carry no badge and the line says so. A preview that assumed `create` while the
// answer was in flight would be wrong for exactly the rows this feature exists to explain.

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { SpeakerImportPlan } from '@/features/speakers/csv-import'
import { dispositionOf, importCounts, importCountsLabel } from '@/features/speakers/import-outcome'

export function SpeakerImportPreview({
  plan,
  existing,
  checking,
  problem,
}: {
  plan: SpeakerImportPlan
  /** Normalized addresses that already hold a speaker record, or undefined if not yet asked. */
  existing: ReadonlySet<string> | undefined
  checking: boolean
  /** Why the existing-speaker check could not run, if it could not. Import may still proceed. */
  problem: string | undefined
}) {
  const counts = existing === undefined ? undefined : importCounts(rowEmails(plan), existing)

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        <span className="font-medium tabular-nums">{plan.rows.length}</span> ready to import
        {counts === undefined ? '' : `: ${importCountsLabel(counts)}`}.
      </p>

      {problem === undefined ? null : (
        <p className="text-pretty text-muted-foreground">
          Existing speakers could not be checked ({problem}). The import still runs and still
          matches on email.
        </p>
      )}
      {checking && problem === undefined ? (
        <p className="text-muted-foreground">Checking which addresses already exist...</p>
      ) : null}

      {plan.rows.length === 0 ? null : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead className="w-32">Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.rows.map((row) => (
              <TableRow key={row.email}>
                <TableCell className="text-muted-foreground">{row.email}</TableCell>
                <TableCell>
                  <OutcomeCell email={row.email} existing={existing} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {plan.problems.length === 0 ? null : (
        <ul className="flex flex-col gap-1 text-muted-foreground">
          {plan.problems.map((entry) => (
            <li key={`${String(entry.line)}-${entry.message}`}>
              Line {entry.line}: {entry.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** One row's outcome, or a dash while the answer is still in flight. */
function OutcomeCell({
  email,
  existing,
}: {
  email: string
  existing: ReadonlySet<string> | undefined
}) {
  if (existing === undefined) return <span className="text-muted-foreground">-</span>
  if (dispositionOf(email, existing) === 'update') return <Badge variant="secondary">Update</Badge>
  return <Badge variant="outline">New speaker</Badge>
}

export function rowEmails(plan: SpeakerImportPlan): readonly string[] {
  return plan.rows.map((row) => row.email)
}
