'use client'

// The modal behind `Download files bundle...`, built from the reference.
//
// docs/parity/external-references.md, "Bulk file download", is the record for the contents:
// a `Group files by` control that "reorganize[s] how files will appear in folders",
// individual files that can be deselected, only the latest version of each file, a
// `Generate Download` button, and then "You will receive an email once the file is ready to
// download". Every one of those strings is that reference's wording, not a rewrite.
//
// The one thing it does NOT take from the reference is the menu item's own label, which stays
// `Download files bundle...`. Our own screenshots (ref 22) show that wording and the parity
// docs win on presentation (CLAUDE.md, "Precedence, by domain").
//
// A centred `Dialog`, not a `Sheet`: the reference shows a modal, and .claude/rules/ui-shadcn
// reserves the drawer for the Preferences and Add Abstract surfaces.
//
// The grouping control, the file list and the total live in `@/features/bundle/FileBundlePanel`,
// shared with the three surfaces that export by streaming. This file owns the state, the read
// and the submit, and the submit is where it stays different: this modal QUEUES AN EMAILED
// LINK, because a session selection can cover fifty sessions and the organizer is not expected
// to wait, while the Files lists and the File Requests board stream the archive back on a GET.
// That difference is deliberate. The panel knows nothing about either.

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
import { generateBundleAction, listBundleFilesAction } from '@/features/bundle/actions'
import { type FileBundleListingState, FileBundlePanel } from '@/features/bundle/FileBundlePanel'
import { bundleSizeLabel, countLabel } from '@/features/bundle/format'
import {
  type BundleGrouping,
  bundleEntryPaths,
  DEFAULT_BUNDLE_GROUPING,
} from '@/features/bundle/grouping'
import { MAX_BUNDLE_SESSIONS } from '@/features/bundle/selection'
import { type SubmissionScope, scopeCopy } from '@/features/review/submission-scope'
import { storedArchiveSize } from '@/utils/zip-records'

/**
 * Mounted only while the dialog is open (see AbstractsOptionsMenu), which is what makes the
 * state below correct without a reset effect: a fresh mount starts at `loading` with nothing
 * deselected. `react-hooks/set-state-in-effect` rejects the alternative, and rightly, since
 * resetting four pieces of state on an `open` transition is three cascading renders.
 */
export type DownloadFilesBundleDialogProps = {
  eventId: string
  onOpenChange: (open: boolean) => void
  /** The ticked rows. "Scope is the checked selection", per the reference. */
  sessionIds: readonly string[]
  /**
   * Which of the three SUBMISSIONS surfaces opened this, because the three messages below
   * name what the organizer ticked. They all said "abstracts", and the same table renders
   * at /sessions and /submissions, so the dialog told a Sessions organizer to tick
   * abstracts.
   */
  scope: SubmissionScope
}

/**
 * What this surface calls its rows: `abstracts`, `sessions`, `submissions`.
 *
 * Read off `scopeCopy` rather than declared here, because a fourth list of nouns is how one
 * surface ends up calling the same thing two things. The server-side refusals in
 * `features/bundle/request.ts` read the same entry, so the toast an organizer gets when the
 * selection changes under them says the same word as the dialog they were just looking at.
 */
function scopeNoun(scope: SubmissionScope): string {
  return scopeCopy(scope).plural
}

function problemMessage(
  problem: 'empty' | 'too-many' | undefined,
  files: number,
  noun: string,
): string | undefined {
  if (problem === 'empty') {
    return `Tick the ${noun} whose files you want, then open this again. A download covers the checked selection.`
  }
  if (problem === 'too-many') {
    return `A download covers at most ${String(MAX_BUNDLE_SESSIONS)} ${noun} at a time. Untick some rows and try again.`
  }
  if (files === 0) return `The ${noun} you selected have no files attached.`
  return undefined
}

export function DownloadFilesBundleDialog({
  eventId,
  onOpenChange,
  sessionIds,
  scope,
}: DownloadFilesBundleDialogProps) {
  const noun = scopeNoun(scope)
  const [listing, setListing] = useState<FileBundleListingState>({ state: 'loading' })
  const [grouping, setGrouping] = useState<BundleGrouping>(DEFAULT_BUNDLE_GROUPING)
  const [deselected, setDeselected] = useState<readonly string[]>([])
  const [pending, setPending] = useState(false)
  // The reference's confirmation replaces the body rather than closing the modal, so the
  // organizer reads "you will receive an email" instead of watching a dialog vanish.
  const [queued, setQueued] = useState<string | undefined>(undefined)

  // One read per mount, and a mount is one opening of the dialog. The selection is read at
  // that moment rather than when the Options menu rendered, which is the whole reason this is
  // an effect: the ticks change while the menu is closed.
  useEffect(() => {
    // A holder rather than a bare `let`, because TypeScript narrows a captured boolean to its
    // initial literal and `no-unnecessary-condition` then calls the guard dead code.
    const mounted = { current: true }

    void (async () => {
      const result = await listBundleFilesAction({ eventId, sessionIds: [...sessionIds] })
      if (!mounted.current) return
      if (!result.ok) {
        setListing({ state: 'problem', message: result.message })
        return
      }
      const message = problemMessage(result.problem, result.files.length, noun)
      setListing(
        message === undefined
          ? { state: 'ready', files: result.files }
          : { state: 'problem', message },
      )
    })()

    return () => {
      mounted.current = false
    }
    // `noun` is derived from `scope`, so it only changes when a different surface opens the
    // dialog, which is a different mount anyway.
  }, [eventId, sessionIds, noun])

  const files = listing.state === 'ready' ? listing.files : []
  const included = files.filter((file) => !deselected.includes(file.id))
  const sizeById = new Map(included.map((file) => [file.id, file.size]))
  // Computed here rather than through an action: it is arithmetic over a list the client
  // already holds, and the grouping changes the paths, so a round trip per change would be a
  // request per click. `bundleEntryPaths` and `storedArchiveSize` are both pure.
  //
  // `kind` used to be hardcoded to `doc` here, because the listing did not carry it. Under the
  // `File type` grouping that folded every file into one `Documents/` folder, so the collision
  // suffixes the preview computed, and therefore the size it reported, disagreed with the
  // archive the route would actually build. `BundleFileRow` carries the real value now.
  const totalBytes = storedArchiveSize(
    bundleEntryPaths(included, grouping).map((entry) => ({
      path: entry.path,
      size: sizeById.get(entry.id) ?? 0,
    })),
  )

  const generate = () => {
    setPending(true)
    void (async () => {
      const result = await generateBundleAction({
        eventId,
        sessionIds: [...sessionIds],
        grouping,
        deselectedFileIds: [...deselected],
        surface: scope,
      })
      setPending(false)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setQueued(result.toEmail)
    })()
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Download files bundle</DialogTitle>
          <DialogDescription>
            Only the latest version of each file is included. Previous versions cannot be included
            in a file and must be downloaded directly from the session content tab.
          </DialogDescription>
        </DialogHeader>

        {queued === undefined ? (
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
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            You will receive an email once the file is ready to download. It is on its way to{' '}
            <span className="font-medium text-foreground">{queued}</span>.
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {queued === undefined ? 'Cancel' : 'Close'}
          </Button>
          {queued === undefined ? (
            <Button disabled={pending || included.length === 0} onClick={generate}>
              Generate Download
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
