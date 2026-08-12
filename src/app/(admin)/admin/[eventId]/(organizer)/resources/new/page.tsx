// /admin/[eventId]/resources/new
//
// A static segment beside `[resourceId]`, so Next resolves it first and no record id can
// ever be the string `new`. The alternative, treating `new` as a sentinel inside the
// dynamic route, makes every read there conditional on a magic value.
//
// It still reads the event's pages, for one reason: a new page's default `order` should put
// it at the end of the list rather than at 0, where it would jump ahead of everything the
// organizer has already arranged.

import { requireEventId } from '@/features/events/resolve-ref'
import { isEventOrganizer } from '@/features/resources/authorize'
import { resourceFormValues } from '@/features/resources/form'
import { ResourceEditor } from '@/features/resources/ResourceEditor'
import { readAdminResources } from '@/features/resources/reads'

export const metadata = { title: 'New resource page' }

export default async function NewResourcePage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)
  if (!(await isEventOrganizer(eventId))) return null

  const entries = await readAdminResources(eventId)
  const nextOrder = entries.reduce((max, entry) => Math.max(max, entry.resource.order), 0) + 1

  return (
    <ResourceEditor eventId={eventId} values={resourceFormValues({ enabled: false, nextOrder })} />
  )
}
