'use client'

// Step 1: which event the speakers join, and the file itself.
//
// The event picker is here rather than on the commit step because it changes what the preview
// MEANS: an address already in the base is an update whichever event is chosen, but the row
// that lands adds the speaker to this one, and being asked for it at the end would be a
// question about work already reviewed. The CRM is the one admin surface with no event in its
// URL (`features/crm/scope.ts`), so unlike every other write here there is nothing in the path
// to take the answer from.
//
// Copy: `Upload a file to import` is Sessionboard's own label for this control
// (docs/parity/external-references.md). `Generate Import Template` sits beside it there and is
// deliberately absent: the mapping step accepts whatever headers a file already has, so a
// template would be a download that buys nothing.

import { FileSpreadsheetIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type ImportEventOption = { readonly id: string; readonly name: string }

/** What the step shows about the file already chosen. */
export type UploadedFile = {
  readonly name: string
  readonly rowCount: number
  readonly columnCount: number
}

export type ImportUploadStepProps = {
  events: readonly ImportEventOption[]
  eventId: string
  onEventChange: (eventId: string) => void
  file: UploadedFile | undefined
  onPick: (file: File) => void
  /** A file that could not be used at all: too big, or nothing a CSV parse could read. */
  problem: string | undefined
  disabled: boolean
}

export function ImportUploadStep({
  events,
  eventId,
  onEventChange,
  file,
  onPick,
  problem,
  disabled,
}: ImportUploadStepProps) {
  const eventItems = events.map((event) => ({ value: event.id, label: event.name }))

  return (
    <div className="flex flex-col gap-5">
      <div className="flex max-w-sm flex-col gap-1.5">
        <Label htmlFor="import-event">Add speakers to</Label>
        <Select
          value={eventId}
          items={eventItems}
          disabled={disabled}
          onValueChange={(next: string | null) => {
            if (next !== null) onEventChange(next)
          }}
        >
          <SelectTrigger id="import-event" className="w-full">
            <SelectValue placeholder="Pick an event" />
          </SelectTrigger>
          <SelectContent>
            {eventItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-sm">
          Everyone in the file joins this event. A speaker who is already in the CRM keeps the
          events they are on.
        </p>
      </div>

      <div className="flex max-w-sm flex-col gap-1.5">
        <Label htmlFor="import-file">Upload a file to import</Label>
        <Input
          id="import-file"
          type="file"
          accept=".csv,text/csv"
          disabled={disabled}
          onChange={(event) => {
            const picked = event.target.files?.[0]
            if (picked !== undefined) onPick(picked)
            // Cleared so picking the SAME file again after fixing it still fires a change.
            event.target.value = ''
          }}
        />
        <p className="text-muted-foreground text-sm">
          CSV, with a header row. The first row is read as the column names.
        </p>
      </div>

      {problem === undefined ? null : (
        <Alert variant="destructive">
          <AlertTitle>That file could not be read</AlertTitle>
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      )}

      {file === undefined ? null : (
        <Alert>
          <FileSpreadsheetIcon />
          <AlertTitle>{file.name}</AlertTitle>
          <AlertDescription>
            {file.rowCount} {file.rowCount === 1 ? 'row' : 'rows'}, {file.columnCount}{' '}
            {file.columnCount === 1 ? 'column' : 'columns'}.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
