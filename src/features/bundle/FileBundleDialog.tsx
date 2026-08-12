'use client'

// The dialog behind EXPORT on SUBMISSIONS > Files and PORTALS > Files.
//
// The contents follow the same reference as the abstracts modal
// (docs/parity/external-references.md, "Bulk file download"): a `Group files by` control that
// reorganizes how files appear in folders, individual files that can be deselected, only the
// latest version of each file, and a `Generate Download` button.
//
// What differs is the DELIVERY, and it differs on purpose. The abstracts flow emails a link
// because it can cover fifty sessions and the organizer is not expected to wait. This
// selection is rows the organizer just ticked on the screen in front of them, so the archive
// streams straight back on a GET they navigate to and the browser saves it. That is also why
// there is a confirmation state rather than a closing dialog: a download that starts by
// navigation gives no visible feedback in the page, so the dialog says so itself and keeps a
// link to start it again.
//
// Mounted only while open (see the EXPORT button in features/files/FilesTable), which is what
// makes the state below correct with no reset effect: a fresh mount starts at `loading` with
// nothing deselected.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  type BundleSource,
  listBundleSource,
  prepareBundleSource,
  sourceEmptyMessage,
} from '@/features/bundle/bundle-source'
import { type FileBundleListingState, FileBundlePanel } from '@/features/bundle/FileBundlePanel'
// The panel is shared with the abstracts modal, which delivers by email instead. See its
// header: the difference is in the submit, and neither dialog leaks it into the panel.
import { bundleSizeLabel, countLabel } from '@/features/bundle/format'
import {
  type BundleGrouping,
  bundleEntryPaths,
  DEFAULT_BUNDLE_GROUPING,
} from '@/features/bundle/grouping'
import { storedArchiveSize } from '@/utils/zip-records'

export type FileBundleDialogProps = {
  eventId: string
  onOpenChange: (open: boolean) => void
  /**
   * What was ticked, and on which surface. Scope is the checked selection, per the reference.
   * A `requests` source resolves to files server-side; see ./bundle-source.
   */
  source: BundleSource
}

type StartedState = {
  readonly downloadPath: string
  readonly fileCount: number
  readonly totalBytes: number
}

export function FileBundleDialog({ eventId, onOpenChange, source }: FileBundleDialogProps) {
  const [listing, setListing] = useState<FileBundleListingState>({ state: 'loading' })
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [grouping, setGrouping] = useState<BundleGrouping>(DEFAULT_BUNDLE_GROUPING)
  const [deselected, setDeselected] = useState<readonly string[]>([])
  const [pending, setPending] = useState(false)
  const [started, setStarted] = useState<StartedState | undefined>(undefined)

  // One read per mount, and a mount is one opening of the dialog. A holder rather than a bare
  // `let`, because TypeScript narrows a captured boolean to its initial literal and
  // `no-unnecessary-condition` then calls the guard dead code.
  useEffect(() => {
    const mounted = { current: true }

    void (async () => {
      const result = await listBundleSource(eventId, source)
      if (!mounted.current) return
      if (!result.ok) {
        setListing({ state: 'problem', message: result.message })
        return
      }
      setNotice(result.notice)
      const message = sourceEmptyMessage(source, result.problem, result.files.length)
      setListing(
        message === undefined
          ? { state: 'ready', files: result.files }
          : { state: 'problem', message },
      )
    })()

    return () => {
      mounted.current = false
    }
  }, [eventId, source])

  const files = listing.state === 'ready' ? listing.files : []
  const included = files.filter((file) => !deselected.includes(file.id))
  const sizeById = new Map(included.map((file) => [file.id, file.size]))
  // Arithmetic over a list the client already holds, so it is computed here rather than
  // through an action: the grouping changes the paths, and a round trip per change would be a
  // request per click. `bundleEntryPaths` and `storedArchiveSize` are both pure.
  const totalBytes = storedArchiveSize(
    bundleEntryPaths(included, grouping).map((entry) => ({
      path: entry.path,
      size: sizeById.get(entry.id) ?? 0,
    })),
  )

  const generate = () => {
    setPending(true)
    void (async () => {
      const result = await prepareBundleSource({
        eventId,
        source,
        grouping,
        deselectedFileIds: deselected,
      })
      setPending(false)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setStarted({
        downloadPath: result.downloadPath,
        fileCount: result.fileCount,
        totalBytes: result.totalBytes,
      })
      // The response is `Content-Disposition: attachment`, so this saves the archive and
      // leaves the page where it is rather than navigating away from the dialog.
      globalThis.location.assign(result.downloadPath)
    })()
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Export files</DialogTitle>
          <DialogDescription>
            Only the latest version of each file is included. Previous versions cannot be included
            in a file and must be downloaded directly from the session content tab.
          </DialogDescription>
        </DialogHeader>

        {started === undefined ? (
          <FileBundlePanel
            listing={listing}
            grouping={grouping}
            onGroupingChange={setGrouping}
            deselected={deselected}
            onToggle={(fileId, include) => {
              setDeselected((current) =>
                include ? current.filter((id) => id !== fileId) : [...current, fileId],
              )
            }}
            summary={`${countLabel(included.length, 'file')}, about ${bundleSizeLabel(totalBytes)}`}
            notice={notice}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Your download has started:{' '}
            <span className="font-medium text-foreground">
              {countLabel(started.fileCount, 'file')}, about {bundleSizeLabel(started.totalBytes)}
            </span>
            . Large archives keep streaming for a while after the browser reports the save.
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {started === undefined ? 'Cancel' : 'Close'}
          </Button>
          {started === undefined ? (
            <Button disabled={pending || included.length === 0} onClick={generate}>
              {pending ? 'Generating...' : 'Generate Download'}
            </Button>
          ) : (
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href={started.downloadPath} download />}
            >
              Download again
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
