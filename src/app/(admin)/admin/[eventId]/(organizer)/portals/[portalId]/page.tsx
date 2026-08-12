// /admin/[eventId]/portals/[portalId]
//
// The editor half of BUILD_SPEC 5.0c's "a list, then an editor", and it is a ROUTE rather
// than a drawer off the list. Three reasons, in order: `Edit Tasks` on the row menu is a
// destination an organizer expects to be able to link to and come back to; the four content
// cards plus the settings card are a page's worth of surface, which a `Sheet` would scroll
// inside a scroller; and the assigned-speaker counts are two composed reads that deserve
// their own `loading.tsx` boundary rather than a spinner inside a dialog that already opened.
//
// `notFound()` is called in the page BODY, never from inside a `<Suspense>` boundary: on
// Workers a boundary that resolves after the shell has flushed answers HTTP 200 with the 404
// body, which nothing errors on and only a status check finds
// (`.claude/rules/bodo-conventions.md`). `loading.tsx` beside this file is itself such a
// boundary, and the admin tree accepts that cost deliberately so the shell can paint.
//
// THE COUNTS COME FROM THE ADMIN VIEWS THE TASKS AND FILE REQUESTS SCREENS ALREADY COMPOSE,
// per §5.0c, and not from a per-row read: a fan-out of one query per task against a 5 req/s
// base is how this screen would start returning 429 on an event with thirty tasks.

import { DoorOpenIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ButtonLink } from '@/components/primitives/ButtonLink'
import { PageHeader } from '@/components/primitives/PageHeader'
import { Badge } from '@/components/ui/badge'
import { requireEventId } from '@/features/events/resolve-ref'
import { loadFileRequestsAdminView } from '@/features/file-requests/admin-view'
import { isEventOrganizer } from '@/features/portal-config/authorize'
import { readPortalEditor } from '@/features/portal-config/reads'
import { loadTasksAdminView } from '@/features/tasks/admin-view'
import { listTags, listTracks } from '@/services/airtable/queries'

import { PortalContentEditor } from '../PortalContentEditor'

export const metadata = { title: 'Portal' }

export default async function PortalEditorPage({
  params,
}: {
  params: Promise<{ eventId: string; portalId: string }>
}) {
  const { eventId: eventRef, portalId } = await params
  const eventId = await requireEventId(eventRef)

  // The layout redirects an unauthorized browser; this is not the security boundary. Both
  // writes behind this page re-check the role and that the portal belongs to the event.
  if (!(await isEventOrganizer(eventId))) return null

  const editor = await readPortalEditor(eventId, portalId)
  if (editor === undefined) notFound()

  const [tracks, tags, tasks, fileRequests] = await Promise.all([
    listTracks(eventId),
    listTags(eventId),
    loadTasksAdminView(eventId),
    loadFileRequestsAdminView(eventId),
  ])

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        icon={DoorOpenIcon}
        title={editor.portal.name}
        description="Switching a row on shows it in this portal to the people it already applies to. Nothing here assigns anybody anything."
        leading={
          <ButtonLink href={`/admin/${eventId}/portals`} variant="ghost" size="sm">
            Back to Portals
          </ButtonLink>
        }
        actions={editor.portal.isDefault ? <Badge variant="secondary">Default</Badge> : undefined}
      />

      <PortalContentEditor
        eventId={eventId}
        portal={editor.portal}
        content={editor.content}
        assigned={[
          ...tasks.cards.map((card) => ({ itemId: card.id, count: card.assigned })),
          ...fileRequests.cards.map((card) => ({ itemId: card.id, count: card.assigned })),
        ]}
        tracks={tracks.map((track) => ({ id: track.id, name: track.name }))}
        tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
      />
    </div>
  )
}
