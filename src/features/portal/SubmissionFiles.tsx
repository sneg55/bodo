// Files attached to a submission (BUILD_SPEC 5.2), as a VERSION LIST.
//
// It used to be a flat list of filename, size and a `Private` badge, and two uploads of the
// same corrected deck rendered as two identical lines. Everything that made them different
// was already known and none of it was shown: which one is current, when each arrived, and
// how to open either. The organizer's PROGRAM > Files table showed all three, so the two
// halves of the product described the same two objects differently, and the speaker's half
// was the one with nothing to click.
//
// So the row now carries what that table carries: the version chip (`Latest of 2`, `v1`),
// the upload timestamp with the TIME in it, and a control per row. Superseded rows are
// DIMMED rather than hidden, the same decision `FilesTable` records: hiding them would lose
// the history that re-uploading has always kept, and a speaker asking "did my fix land"
// needs to see both.
//
// A public object links straight at the bucket. A private one goes through
// `/api/portal/files/<id>`, which re-derives ownership from the session, and comes back as
// an attachment, so the control reads `Download` and saves rather than replacing the tab.

import { FileIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FileCommentsThread } from '@/features/portal/FileCommentsThread'
import type { SubmissionFileView } from '@/features/portal/submission-files'
import { cn } from '@/utils/cn'

export type { SubmissionFileView }

export function SubmissionFiles({ files }: { files: readonly SubmissionFileView[] }) {
  if (files.length === 0) {
    return <p className="text-sm text-muted-foreground">No files are attached.</p>
  }

  return (
    <ul className="space-y-2">
      {files.map((file) => (
        <li
          key={file.id}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2"
        >
          <FileIcon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span
                className={cn(
                  'truncate text-sm',
                  file.isLatest ? undefined : 'text-muted-foreground',
                )}
              >
                {file.filename}
              </span>
              {/* Omitted at one upload, where `Latest of 1` is noise rather than a fact. */}
              {file.groupSize === 1 ? null : (
                <Badge variant={file.isLatest ? 'default' : 'outline'} className="shrink-0">
                  {file.isLatest
                    ? `Latest of ${String(file.groupSize)}`
                    : `v${String(file.version)}`}
                </Badge>
              )}
            </div>
            {/* The size and the moment it arrived, on one line. The time is the half that was
                missing: two uploads on the same afternoon both read `Aug 9, 2026`, so nothing
                displayed could order them. */}
            <p className="text-xs tabular-nums text-muted-foreground">
              {file.sizeLabel} &middot; Uploaded {file.uploadedText}
            </p>
          </div>
          {file.visibility === 'private' ? <Badge variant="outline">Private</Badge> : null}

          {/* The comment thread, which was reachable on a REQUESTED file and nowhere else.
              An organizer can comment on any row of the admin Files table, and the helper
              text on that popover says the note lets a speaker be told what to change; for
              a deck attached to a submission, nothing told them. "Re-export this without
              the speaker notes" was written into a popover the only person who could act on
              it had no way to open, and the organizer had every reason to think it had been
              delivered. Same component and the same two actions the file-request rows use:
              both authorize against the FILE, so nothing new is exposed by rendering it
              here, and it loads on open rather than per row. */}
          <FileCommentsThread fileId={file.id} label={file.filename} />

          {file.href === undefined ? (
            // The only absence left, and it is a DEPLOYMENT fact rather than a property of
            // the file: a public object with no link means `R2_PUBLIC_BASE_URL` is unset.
            <span className="text-xs text-muted-foreground">No link configured</span>
          ) : (
            // 28px in a 54px row, centred on the two text lines beside it, and the rows are
            // 8px apart: the next row's control is 34px below this one, so the band's 6px is
            // clear of it. `Comments` is 12px to its left and the band adds no width.
            <Button
              variant="outline"
              size="sm"
              className="hit-area-y"
              nativeButton={false}
              render={
                file.download ? (
                  <a href={file.href} download={file.filename} />
                ) : (
                  <a href={file.href} rel="noreferrer noopener" target="_blank" />
                )
              }
            >
              {file.download ? 'Download' : 'Open'}
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
