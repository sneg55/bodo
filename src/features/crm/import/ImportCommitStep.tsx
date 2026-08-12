'use client'

// Step 4: the confirmation, and then what actually happened.
//
// One step and not two, because the wizard's own footer carries the button that runs the
// import (`StepWizard`'s finish control), so the step body is the sentence beside it before,
// and the receipt after. A separate "done" step would be a step nobody can navigate to and
// nobody can leave.
//
// The receipt is honest about partial success, which is the normal outcome rather than the
// exceptional one: `upsertSpeakersBatch` never throws for a single bad row, so a 500-row file
// with three bad addresses lands 497 people and reports three failures. Those three are
// downloadable as a CSV that echoes the organizer's own columns, so the fix is made in the
// file they already have.

import { DownloadIcon } from 'lucide-react'
import Link from 'next/link'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { ImportCommitted } from '@/features/crm/import/actions'

export type ImportCommitStepProps = {
  eventName: string
  /** What the preview said would be attempted, for the sentence before the button. */
  plannedCount: number
  result: ImportCommitted | undefined
  onDownloadReport: () => void
  /** Whether anything at all is downloadable: no failures, no report. */
  reportable: boolean
}

export function ImportCommitStep({
  eventName,
  plannedCount,
  result,
  onDownloadReport,
  reportable,
}: ImportCommitStepProps) {
  if (result === undefined) {
    return (
      <p className="text-sm">
        {plannedCount} {plannedCount === 1 ? 'row' : 'rows'} will be imported into{' '}
        <span className="font-medium">{eventName}</span>. Nothing has been written yet.
      </p>
    )
  }

  const { summary, skipped } = result
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-3 gap-4">
        <Figure label="Created" value={summary.created} />
        <Figure label="Updated" value={summary.updated} />
        <Figure label="Failed" value={summary.failed} />
      </dl>

      {skipped.length === 0 ? null : (
        <Alert>
          <AlertTitle>
            {skipped.length} {skipped.length === 1 ? 'row' : 'rows'} skipped as repeats
          </AlertTitle>
          <AlertDescription>
            {/* Whole rows, so a repeat carrying a field the first row lacked is not merged in
                behind the organizer's back; `dedupeRows` says why. */}
            Row {skipped.join(', row ')} repeated an address earlier in the file. Only the first
            line for each person was imported.
          </AlertDescription>
        </Alert>
      )}

      {summary.failed === 0 ? null : (
        <Alert variant="destructive">
          <AlertTitle>
            {summary.failed} {summary.failed === 1 ? 'row' : 'rows'} did not import
          </AlertTitle>
          <AlertDescription>
            <ul className="list-inside list-disc">
              {summary.failures.slice(0, 5).map((failure) => (
                <li key={failure.rowNumber}>
                  Row {failure.rowNumber}: {failure.reason}
                </li>
              ))}
            </ul>
            {summary.failures.length > 5 ? <p>The rest are in the report below.</p> : null}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        {reportable ? (
          <Button type="button" variant="outline" onClick={onDownloadReport}>
            <DownloadIcon data-icon="inline-start" />
            Download error report
          </Button>
        ) : null}
        {/* `nativeButton={false}` because the rendered element is an anchor: base-ui otherwise
            keeps the button semantics and the link stops being a link to a screen reader. */}
        <ButtonLink href="/admin/crm">Back to Speaker CRM</ButtonLink>
      </div>
    </div>
  )
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="font-medium text-2xl tabular-nums">{value}</dd>
    </div>
  )
}
