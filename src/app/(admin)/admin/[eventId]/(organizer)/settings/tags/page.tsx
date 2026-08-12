// Event Settings > Library > Tags: tracks, tags and rooms.
//
// Three reads in parallel, all three cached under `event:{id}:lookups`, which is the tag
// every write on this page expires.

import { requireEventId } from '@/features/events/resolve-ref'
import { isSettingsOrganizer } from '@/features/settings/authorize'
import { LibraryPanel } from '@/features/settings/LibraryPanel'
import { listRooms, listTags, listTracks } from '@/services/airtable/queries'

export const metadata = { title: 'Tags' }

export default async function LibraryTagsPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ eventId: eventRef }, query] = await Promise.all([params, searchParams])
  const eventId = await requireEventId(eventRef)
  const tab = query.tab
  if (!(await isSettingsOrganizer(eventId))) return null

  const [tracks, tags, rooms] = await Promise.all([
    listTracks(eventId),
    listTags(eventId),
    listRooms(eventId),
  ])

  return (
    <LibraryPanel
      eventId={eventId}
      tracks={tracks.map((track) => ({ id: track.id, name: track.name }))}
      tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
      rooms={rooms.map((room) => ({ id: room.id, name: room.name }))}
      // So a link can land on the list it means. See LibraryPanelProps.initialTab.
      initialTab={typeof tab === 'string' ? tab : tab?.at(0)}
    />
  )
}
