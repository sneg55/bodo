'use client'

// The Requested Files card body: one row per document an organizer has asked this speaker for.
//
// Authored, like the card around it, because the screenshot set has no speaker-facing file
// request surface. Two things it deliberately borrows rather than invents: the file control is
// the same `FileInput` plus `uploadFile` pair `TaskCompletion` uses for an upload task,
// so there is one upload path in the portal and not two, and the copy for a delivered row reads
// like the rest of the portal rather than announcing a new vocabulary.
//
// The upload goes to /api/files/upload and not through a Server Action, for the reason
// BUILD_SPEC 5.2 gives: an action receives its body already buffered into a FormData, and a
// 25 MB deck buffered on a Worker is the failure the streaming route exists to avoid. The route
// writes the `Files` row AND moves the assignment to received, so all this has to do afterwards
// is ask the router for fresh server output.

import { FileIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { FileInput } from '@/components/primitives/FileInput'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { DeliveredVersionView, RequestUploadView } from '@/features/file-requests/portal-view'
import { FileCommentsThread } from '@/features/portal/FileCommentsThread'
import { uploadFile, uploadKindFor } from '@/features/portal/upload-client'
import { useHydrated } from '@/features/portal/use-hydrated'
import { uploadHint } from '@/services/storage/upload-hint'
import { cn } from '@/utils/cn'

/**
 * What a deliverable may be: all three kinds, because `uploadKindFor` decides between them
 * from the chosen file's type, which is after the point where this has to be said.
 *
 * `image` is in the list because a file request routinely asks for a photograph, and until
 * it was there a PNG classified as `doc` and was refused after the speaker had chosen it,
 * under a constraint line naming only PDF and Office documents. `uploadHint` groups by cap,
 * so the sentence names the image types at 10 MB and the documents at 25 MB rather than
 * flattening both to the tighter number.
 */
const DELIVERABLE = uploadHint('image', 'slides', 'doc')

export function RequestedFilesPanel({ requests }: { requests: readonly RequestUploadView[] }) {
  if (requests.length === 0) {
    return <p className="text-sm text-muted-foreground">No files requested.</p>
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {requests.map((request) => (
        <li key={request.assignmentId} className="py-3 first:pt-0 last:pb-0">
          <RequestRow request={request} />
        </li>
      ))}
    </ul>
  )
}

function RequestRow({ request }: { request: RequestUploadView }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [justUploaded, setJustUploaded] = useState<string | undefined>(undefined)
  // A file chosen before this row hydrates reaches no `onChange` at all: the picker opens,
  // the speaker selects their deck, and nothing happens and nothing says so. See
  // ./use-hydrated.ts, which was written for the same failure on the profile Save.
  const ready = useHydrated()

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    if (file === undefined) return

    startTransition(async () => {
      const stored = await uploadFile({
        file,
        kind: uploadKindFor(file.type),
        // Sent so the row is also filed against the session, for a per-session request. The
        // route resolves it through the same ownership check every portal mutation uses.
        code: request.submissionCode,
        fileRequestId: request.fileRequestId,
      })
      if (!stored.ok) {
        toast.error(stored.message)
        return
      }
      setJustUploaded(file.name)
      toast.success('File uploaded.', { description: request.title })
      // The route has already expired this speaker's file request tag, so the next server
      // render reads the row as received. This is what makes one happen.
      router.refresh()
    })
  }

  const delivered = request.deliveredFilename ?? justUploaded
  const received = request.received || justUploaded !== undefined

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{request.title}</span>
        {request.required ? <Badge variant="secondary">Required</Badge> : null}
        {received ? <Badge variant="outline">Received</Badge> : null}
      </div>

      {request.submissionLabel === undefined ? null : (
        <span className="text-xs text-muted-foreground">For {request.submissionLabel}</span>
      )}
      {request.dueLabel === undefined ? null : (
        <span className="text-xs text-muted-foreground">{request.dueLabel}</span>
      )}

      {request.instructionsHtml === undefined ? null : (
        <Instructions html={request.instructionsHtml} />
      )}

      {received && delivered !== undefined ? (
        <p className="text-pretty text-sm text-muted-foreground">
          {/* "replaces" was not what happens and never was: every upload keeps its own row,
              so the organizer sees a version history with the newest marked. Saying it
              replaced the old one invited a speaker to believe a mistaken upload was gone. */}
          You uploaded <span className="font-medium text-foreground">{delivered}</span>
          {/* Which version it is, when there is more than one. The sentence promised that
              uploading again "adds a new version" and then showed a single filename, so a
              speaker who had re-uploaded could not confirm which of their files the
              organizer would open. Omitted at one file, where "version 1 of 1" is noise. */}
          {request.deliveredVersion === undefined
            ? ''
            : ` (version ${String(request.deliveredVersion.version)} of ${String(request.deliveredVersion.of)})`}
          . Uploading again adds a new version, and the organizer sees the newest one.
        </p>
      ) : null}

      {/* The history, not just the count. The sentence above says "version 2 of 2" and names
          one file; this lists BOTH, says when each arrived, and gives each one a link. Until
          it was here a speaker could not check whether the corrected deck was the one on
          top, which is the only question a version number is asked in order to answer. The
          admin Files table has shown exactly this since versions shipped.

          Server-supplied rows only. `justUploaded` is a filename this browser knows and not
          a record, so a file uploaded in this transition appears once `router.refresh()`
          brings the server's list back. */}
      <DeliveredVersions versions={request.deliveredVersions} />

      {/* The organizer's notes on this file, and a reply. Until this was here the thread
          was organizer-only: a chair asking for a corrected export wrote it into a popover
          the speaker could not open, and nothing anywhere told them a change was wanted.

          Shown only once a file exists, because there is nothing to discuss before that,
          and only for a file the SERVER supplied an id for: `justUploaded` is a filename
          this browser knows and not a record. */}
      {request.deliveredFileId === undefined ? null : (
        <div>
          <FileCommentsThread fileId={request.deliveredFileId} label={request.title} />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`request-${request.assignmentId}`} className="text-xs">
          {received ? 'Upload a new version' : 'Upload a file'}
        </Label>
        <FileInput
          id={`request-${request.assignmentId}`}
          accept={DELIVERABLE.accept}
          disabled={pending || !ready}
          onChange={handleFile}
        />
        {/* The constraints, stated BEFORE a file is chosen. They have been enforced on
            every upload since the route shipped and written down nowhere a speaker could
            read them, so the only way to learn that a 40 MB deck is too large was to
            upload it and be refused. */}
        <p className="text-pretty text-xs text-muted-foreground">{DELIVERABLE.text}</p>
      </div>
    </div>
  )
}

/**
 * Every version delivered against one request, newest first.
 *
 * Rendered as a list rather than a table on purpose: this sits inside a card in a
 * single-column portal, where a table would be the only horizontally scrolling thing on the
 * page. Superseded rows are dimmed and not hidden, the same decision the admin table and the
 * submission detail's Files card both record, because "did my corrected file land" is
 * answered by seeing both.
 *
 * `download` on the anchor and not `target="_blank"`: the route serves the object as an
 * attachment, so it saves rather than replacing the portal tab the speaker clicked from.
 */
function DeliveredVersions({ versions }: { versions: readonly DeliveredVersionView[] }) {
  if (versions.length === 0) return null

  return (
    <ul className="flex flex-col gap-1">
      {versions.map((entry) => (
        <li
          key={entry.fileId}
          className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1.5"
        >
          <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm',
              entry.isLatest ? undefined : 'text-muted-foreground',
            )}
          >
            {entry.filename}
          </span>
          <Badge variant={entry.isLatest ? 'default' : 'outline'}>
            {entry.isLatest ? 'Latest' : `v${String(entry.version)}`}
          </Badge>
          {/* `tabular-nums` because these date-times stack: one per version, each sitting
              between the version badge and the Download control. Proportional digits give two
              dates of the same format different widths, which offsets the Download buttons
              from each other row to row. */}
          <span className="text-xs text-muted-foreground tabular-nums">{entry.uploadedText}</span>
          {/* 28px in a 43px row on a `gap-1` list, so the next version's Download is 47px
              below this one and the band's 6px each way clears it. */}
          <Button
            variant="outline"
            size="sm"
            className="hit-area-y"
            nativeButton={false}
            render={<a href={entry.href} download={entry.filename} />}
          >
            Download
          </Button>
        </li>
      ))}
    </ul>
  )
}

/**
 * Organizer-authored rich text, rendered as HTML.
 *
 * `dangerouslySetInnerHTML`, over a value already sanitized by `mapFileRequest` at the read
 * boundary. This comment used to say the value needed no escaping because its author already has
 * organizer access to this event, and that if trust ever changed the fix belonged at the write
 * boundary in the drawer. Both halves were wrong, per Codex review. The reader here is a SPEAKER
 * inside their own authenticated portal, so an organizer running script in it crosses a boundary;
 * and a write-boundary sanitizer cannot see a value typed straight into the Airtable cell.
 *
 * Still true: no speaker-supplied value is ever rendered this way.
 */
function Instructions({ html }: { html: string }) {
  return (
    <div
      className="prose-sm max-w-none text-sm text-muted-foreground [&_a]:text-primary [&_a]:underline [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
