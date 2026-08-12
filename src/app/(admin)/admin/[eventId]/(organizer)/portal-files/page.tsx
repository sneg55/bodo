// /admin/[eventId]/portal-files
//
// PORTALS > Files: headshots and documents delivered against a File Request, which is what
// a speaker uploads through their own portal. A requested document filed against a session
// is ALSO on SUBMISSIONS > Files, deliberately: `features/files/file-rows.ts` holds both
// scopes and records why they overlap rather than partition.

import { FileTextIcon } from 'lucide-react'
import { requireEventId } from '@/features/events/resolve-ref'

import { FilesTable } from '@/features/files/FilesTable'
import { loadEventFiles } from '@/features/files/reads'

export default async function PortalFilesPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)
  const view = await loadEventFiles(eventId, 'portal')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <FileTextIcon className="mt-0.5 size-5 text-muted-foreground" />
        <div>
          <h1 className="font-heading text-lg font-medium">Files</h1>
          <p className="text-sm text-muted-foreground">
            Headshots and requested documents, uploaded through the portal
          </p>
        </div>
      </div>

      <FilesTable view={view} scope="portal" eventId={eventId} />
    </div>
  )
}
