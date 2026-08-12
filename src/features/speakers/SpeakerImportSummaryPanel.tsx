'use client'

// What one import run actually did, left on the sheet after it finishes.
//
// A toast was the whole report before this, and a toast fades. The number an operator re-reads
// after a bulk write is exactly this one, and having to run the import again to see it is not
// an option a bulk write offers.
//
// THREE FIGURES, NOT ONE, and the vocabulary is the CRM import wizard's `Created / Updated /
// Failed` verbatim. `Imported 3 speakers` was true of three creates, three updates and every
// mixture between, which is how an eval run concluded the importer had never been observed
// creating anybody: every fixture address already existed, and the app said the same sentence
// it would have said for three new people.

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { SpeakerImportSummary } from '@/features/speakers/import-actions'

export function SpeakerImportSummaryPanel({ summary }: { summary: SpeakerImportSummary }) {
  return (
    <Alert>
      <AlertTitle>Import finished</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span className="flex flex-row gap-4">
          <Figure label="Created" value={summary.created} />
          <Figure label="Updated" value={summary.updated} />
          <Figure label="Failed" value={summary.failed.length} />
        </span>
        {summary.failed.length === 0 ? null : (
          <span>Could not be saved: {summary.failed.join(', ')}</span>
        )}
      </AlertDescription>
    </Alert>
  )
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-medium tabular-nums">{value}</span>
    </span>
  )
}
