'use client'

// "··· Options": Import Sessions, Export .CSV, Export .XLSX, Download files bundle...
//
// Item order and labels are verbatim from docs/parity/abstracts-review.md ref 22, including
// `Download files bundle...` with its ellipsis: the reference product's own modal calls the
// action `Generate Download`, but the parity docs win on presentation (CLAUDE.md,
// "Precedence, by domain") and this is the wording our screenshots caught.
//
// Export .CSV and Download files bundle both work, and they are the only two items. Import
// Sessions and Export .XLSX were cut (SPEC.md:59) and are DELETED rather than greyed out; the
// footnote that used to name them as out of scope went with them on 2026-08-10, because a
// sentence about two controls the organizer can no longer see is a scope boundary they can do
// nothing with. They come back with the feature, not before it.
//
// The bundle needed "zipping R2 objects inside a Worker's memory budget", which the comment
// here used to give as the reason it could not ship. That is now src/utils/zip.ts: a
// STORE-only streaming writer, no dependency, nothing buffered.

import { DownloadIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { AbstractsQueryState } from '@/features/review/abstracts-query'
import { exportAbstractsCsvAction } from '@/features/review/export-actions'
import type { SubmissionScope } from '@/features/review/submission-scope'
import { downloadCsv } from '@/utils/download-csv'
import { DownloadFilesBundleDialog } from './DownloadFilesBundleDialog'

export type AbstractsOptionsMenuProps = {
  eventId: string
  query: AbstractsQueryState
  columnKeys: readonly string[]
  /**
   * The ticked rows, because the reference is explicit that "Scope is the checked selection"
   * rather than all rows or the filtered set (docs/parity/external-references.md, "Bulk file
   * download"). The menu item stays enabled with none ticked, and the modal says what to do:
   * disabling it would make the feature look absent to somebody who has not selected yet.
   */
  selectedIds: readonly string[]
  /** The surface this menu sits on, so the CSV covers and is named after that surface. */
  scope: SubmissionScope
}

export function AbstractsOptionsMenu({
  eventId,
  query,
  columnKeys,
  selectedIds,
  scope,
}: AbstractsOptionsMenuProps) {
  const [pending, startTransition] = useTransition()
  const [bundleOpen, setBundleOpen] = useState(false)

  const exportCsv = () => {
    startTransition(async () => {
      const result = await exportAbstractsCsvAction({ eventId, query, columnKeys, scope })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      downloadCsv(result.filename, result.csv)
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline">··· Options</Button>} />
        <DropdownMenuContent align="end">
          {/* `Import Sessions` and `Export .XLSX` used to sit either side of this, rendered
              permanently `disabled`. Both are cut scope (SPEC.md:59), and a control with
              nothing behind it is deleted here rather than greyed out: a disabled item is a
              promise that it works somewhere, so it sends an organizer looking for the
              permission or the precondition that would enable it. An evaluation agent read
              the pair exactly that way and recorded the surface as offering XLSX export.
              They come back with the feature, not before it. */}
          <DropdownMenuItem disabled={pending} onClick={exportCsv}>
            <DownloadIcon />
            Export .CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setBundleOpen(true)}>
            <DownloadIcon />
            Download files bundle...
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* This footnote used to end "Import and XLSX are not part of this build", which
              outlived the items it was written for: both were deleted from the menu (see
              above), so the sentence was telling an organizer about the absence of two
              controls they could no longer see. What is left is the half that describes
              something real and non-obvious, which is that Export .CSV honours the filters
              and search currently applied rather than dumping the whole event.

              Grouped because `DropdownMenuLabel` is Base UI's `Menu.GroupLabel` and throws
              `MenuGroupContext is missing` outside a Group, so this footnote was crashing
              the Options menu on open. It is its own group rather than joined to the items
              above: it explains all of them, and a GroupLabel is announced as the name of
              the group it sits in, so folding it into the item group would relabel them. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="font-normal text-muted-foreground">
              CSV export covers the current view.
            </DropdownMenuLabel>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Mounted only while open, so each opening reads the current selection and starts with
          nothing deselected. See the note on DownloadFilesBundleDialogProps. */}
      {bundleOpen ? (
        <DownloadFilesBundleDialog
          eventId={eventId}
          sessionIds={selectedIds}
          scope={scope}
          onOpenChange={setBundleOpen}
        />
      ) : null}
    </>
  )
}
