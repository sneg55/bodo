// /admin/[eventId]/files
//
// SUBMISSIONS > Files: everything attached to a session. Its sibling is PORTALS > Files,
// and `features/files/file-rows.ts` holds both scopes: they overlap on a requested document
// that is also filed against a session, because that file answers both descriptions.
//
// It was a `/placeholder/files` card, and the reason given for that was real: there was no
// event-scoped Files read, so the only way to list them was one Airtable listing per
// submission, which is why the bundle download bounds itself at fifty sessions. There is
// one now (`listFilesForEventSpeakers`), it costs a single listing, and
// `createFileRecord` expires its tag.

import { FileTextIcon } from 'lucide-react'
import { requireEventId } from '@/features/events/resolve-ref'

import { FilesTable } from '@/features/files/FilesTable'
import { loadEventFiles } from '@/features/files/reads'

export default async function SubmissionFilesPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)
  const view = await loadEventFiles(eventId, 'submissions')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <FileTextIcon className="mt-0.5 size-5 text-muted-foreground" />
        <div>
          <h1 className="font-heading text-lg font-medium">Files</h1>
          <p className="text-sm text-muted-foreground">
            Everything attached to a submission, newest first
          </p>
        </div>
      </div>

      <FilesTable view={view} scope="submissions" eventId={eventId} />
    </div>
  )
}
