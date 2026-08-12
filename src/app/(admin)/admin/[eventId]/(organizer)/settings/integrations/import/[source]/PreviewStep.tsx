'use client'

// Step: preview. BUILD_SPEC 5.0e, "Preview before commit".
//
// EVERY run is a dry run first, and nothing is written until the organizer presses
// `Import`. The dry run is not an extra cost: it is exactly the reads the real run starts
// with, and the real run does them again anyway.
//
// CREATED AND UPDATED ARE TWO COLUMNS, not a total, because the difference is the whole
// answer to "is this re-run doing what I think". A second run of the same import should be
// almost all updates, and a wall of creates means the idempotency key is not matching. That
// is exactly the thing to see BEFORE pressing the button rather than after.
//
// `skipped` is the third column and it is mostly Accelevents': that is the one provider bodo
// pushes to, so a pull from the same remote event would re-import bodo's own writes.
// `IntegrationMappings` records every remote id bodo authored and those are skipped, and
// BUILD_SPEC requires the number be shown rather than silently subtracted.
//
// The direction is stated in the confirmation in the words of the thing about to happen: a
// one-way inbound pull, updating what a previous run created, creating what is new, never
// deleting and never writing back. The control is `Import`, never `Sync now`.

import Link from 'next/link'
import { useState } from 'react'
import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EMPTY_IMPORT_COUNT, IMPORT_ENTITY_TYPES, type ImportPreview } from '@/types/imports'

/** Authored. bodo's own words for its own tables; the sources name these differently. */
const ENTITY_LABEL = new Map<string, string>([
  ['room', 'Rooms'],
  ['track', 'Tracks'],
  ['tag', 'Tags'],
  ['speaker', 'Speakers'],
  ['submission', 'Sessions'],
  ['participant', 'Participants'],
])

export type PreviewStepProps = {
  preview?: ImportPreview
  /** The provider's own name. The confirmation says it twice, so it is not `preview.source`. */
  providerLabel: string
  loading: boolean
  /** A refused dry run. Shown here rather than as a toast: it is the step's whole content. */
  error?: string
  onRetry: () => void
  onImport: () => void
  cancelHref: string
  disabled: boolean
}

export function PreviewStep({
  preview,
  providerLabel,
  loading,
  error,
  onRetry,
  onImport,
  cancelHref,
  disabled,
}: PreviewStepProps) {
  const [confirming, setConfirming] = useState(false)

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    )
  }

  if (error !== undefined) {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="destructive">
          <AlertTitle>Nothing was read, and nothing was written</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onRetry} disabled={disabled}>
            Try again
          </Button>
          <ButtonLink href={cancelHref} variant="ghost">
            Cancel
          </ButtonLink>
        </div>
      </div>
    )
  }

  if (preview === undefined) {
    return (
      <p className="text-sm text-muted-foreground">
        Go back a step and finish the connection details, then return here for the counts.
      </p>
    )
  }

  const rows = IMPORT_ENTITY_TYPES.map((entity) => ({
    entity,
    label: ENTITY_LABEL.get(entity) ?? entity,
    // `ImportCounts` is a Partial record, so it is read through its entries rather than
    // indexed with the entity name, which is an object-injection sink.
    count: new Map(Object.entries(preview.counts)).get(entity) ?? EMPTY_IMPORT_COUNT,
  }))

  return (
    <div className="flex flex-col gap-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>What</TableHead>
            <TableHead className="text-right">Create</TableHead>
            <TableHead className="text-right">Update</TableHead>
            <TableHead className="text-right">Skip</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.entity}>
              <TableCell className="font-medium">{row.label}</TableCell>
              <TableCell className="text-right tabular-nums">{row.count.created}</TableCell>
              <TableCell className="text-right tabular-nums">{row.count.updated}</TableCell>
              <TableCell className="text-right tabular-nums">{row.count.skipped}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {preview.needsEmailCount > 0 && (
        // Stated before the button, not after the run. An organizer deciding whether to
        // proceed should know that this many speakers will land with no address and that
        // none will be invented for them.
        <Alert>
          <AlertTitle>
            {`${String(preview.needsEmailCount)} speaker${preview.needsEmailCount === 1 ? '' : 's'} will arrive with no email address`}
          </AlertTitle>
          <AlertDescription>
            This source publishes no addresses. bodo will not invent one, so these speakers cannot
            be sent a magic link and own no portal until you fill their address in. The run ends on
            a Needs email list of exactly these people.
          </AlertDescription>
        </Alert>
      )}

      {preview.warnings.length > 0 && (
        <Alert>
          <AlertTitle>Worth knowing before you start</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={disabled}
          onClick={() => {
            setConfirming(true)
          }}
        >
          Import
        </Button>
        <ButtonLink href={cancelHref} variant="ghost">
          Cancel
        </ButtonLink>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import into this event?</AlertDialogTitle>
            <AlertDialogDescription>
              This reads {providerLabel} and writes into this event, in dependency order: rooms,
              tracks and tags first, then speakers, then sessions, then their agenda placement.
              Records a previous import created are updated in place. Nothing is written back to
              {` ${providerLabel}`}, and nothing in this event is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel render={<Button variant="ghost" />}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              render={
                <Button
                  disabled={disabled}
                  onClick={() => {
                    setConfirming(false)
                    onImport()
                  }}
                />
              }
            >
              Import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
