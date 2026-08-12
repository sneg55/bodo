'use client'

// The body of every export dialog: `Group files by`, the deselectable file list, the total.
//
// ONE panel behind all four surfaces: the abstracts / sessions / submissions Options menu,
// SUBMISSIONS > Files, PORTALS > Files and the File Requests board. It lived under the
// abstracts route as `BundleFilesPanel` and was copied once when the Files lists needed it;
// this is the merge, and it was worth doing for more than tidiness. The two copies had
// drifted on a row type: the abstracts one took a row with no `kind`, so its dialog fed a
// hardcoded `doc` into `bundleEntryPaths` and, under the `File type` grouping, previewed
// collision suffixes and a size the route would never produce. One panel with one row type is
// what makes that unrepresentable.
//
// The copy is the reference's (docs/parity/external-references.md, "Bulk file download"),
// which is why the label reads `Group files by` and the hint says it reorganizes how files
// will appear in folders.
//
// This owns no state. Everything arrives as props from whichever dialog mounted it, and the
// two dialogs differ in DELIVERY, not in this: the abstracts one queues an emailed link, the
// other three stream the archive back on a GET. Nothing here knows which.

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { bundleSizeLabel } from '@/features/bundle/format'
import {
  BUNDLE_GROUPING_OPTIONS,
  type BundleGrouping,
  parseGrouping,
} from '@/features/bundle/grouping'

/**
 * One listed file, structurally rather than by import.
 *
 * `BundleFileRow` (./actions) and `FileBundleRow` (./file-actions) both satisfy it and both
 * cross the server boundary from a different pair of actions. Naming a shape here rather than
 * importing one of them keeps this component from depending on either `'use server'` module.
 */
export type BundlePanelFile = {
  readonly id: string
  readonly filename: string
  readonly size: number
  /** `headshot` / `slides` / `doc`. Feeds the `File type` grouping's folder name. */
  readonly kind: string
  readonly sessionLabel: string
  readonly speakerLabel: string
}

export type FileBundleListingState =
  | { readonly state: 'loading' }
  | { readonly state: 'problem'; readonly message: string }
  | { readonly state: 'ready'; readonly files: readonly BundlePanelFile[] }

export type FileBundlePanelProps = {
  listing: FileBundleListingState
  grouping: BundleGrouping
  onGroupingChange: (grouping: BundleGrouping) => void
  deselected: readonly string[]
  onToggle: (fileId: string, include: boolean) => void
  /** "12 files, about 84 MB". Computed by the dialog, which knows the archive arithmetic. */
  summary: string
  /**
   * What the selection could not deliver, above everything else.
   *
   * Only the File Requests board sets it, because only there can a ticked row resolve to no
   * file at all (./request-selection). It renders in the PROBLEM state too, and that is the
   * case it exists for: a dialog that says only "there is nothing to download" after seven
   * rows were ticked reads as a broken export rather than as seven undelivered documents.
   */
  notice?: string
}

export function FileBundlePanel({
  listing,
  grouping,
  onGroupingChange,
  deselected,
  onToggle,
  summary,
  notice,
}: FileBundlePanelProps) {
  if (listing.state === 'loading') {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  const noticeLine =
    notice === undefined ? null : (
      <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">{notice}</p>
    )

  if (listing.state === 'problem') {
    return (
      <div className="flex flex-col gap-3">
        {noticeLine}
        <p className="text-sm text-muted-foreground">{listing.message}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {noticeLine}
      <div className="flex flex-col gap-2">
        <Label htmlFor="bundle-grouping">Group files by</Label>
        <Select
          value={grouping}
          items={BUNDLE_GROUPING_OPTIONS}
          onValueChange={(next: string | null) => {
            // Through `parseGrouping` rather than a cast: the Select hands back a plain
            // string, and the parser is the one place that decides what an unknown one means.
            onGroupingChange(parseGrouping(next))
          }}
        >
          <SelectTrigger id="bundle-grouping" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BUNDLE_GROUPING_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Reorganizes how files will appear in folders inside the archive.
        </p>
      </div>

      <ScrollArea className="h-56 rounded-lg border border-border">
        <ul className="flex flex-col gap-1 p-2">
          {listing.files.map((file) => (
            <li key={file.id} className="flex items-start gap-2.5 rounded-md px-1.5 py-1">
              <Checkbox
                id={`bundle-file-${file.id}`}
                className="mt-0.5"
                checked={!deselected.includes(file.id)}
                onCheckedChange={(checked) => onToggle(file.id, checked === true)}
              />
              <Label
                htmlFor={`bundle-file-${file.id}`}
                className="flex flex-1 flex-col items-start gap-0.5 font-normal"
              >
                <span className="text-sm">{file.filename}</span>
                {/* `tabular-nums` for the size on the end of the line, matching the total
                    below it: the sizes stack down the list and proportional digits make
                    them read as ragged. */}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {[file.sessionLabel, file.speakerLabel, bundleSizeLabel(file.size)]
                    .filter((part) => part !== '')
                    .join(' - ')}
                </span>
              </Label>
            </li>
          ))}
        </ul>
      </ScrollArea>

      <p className="text-sm text-muted-foreground tabular-nums">{summary}</p>
    </div>
  )
}
