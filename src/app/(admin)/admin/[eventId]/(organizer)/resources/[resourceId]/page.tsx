// /admin/[eventId]/resources/[resourceId]
//
// The editor for one existing page. `readAdminResource` resolves the record out of THIS
// event's list rather than by id alone, so a record id belonging to another event is a 404
// here rather than an editable page: the read is the same event scoping the write repeats
// in `ownedResource` (@/features/resources/actions).
//
// `notFound()` is called from the page BODY, before the first byte. A `notFound()` or
// `redirect()` from inside a `<Suspense>` boundary resolves after the shell has flushed and
// then never produces a response, which on Workers is a hung request the runtime cancels.

import { notFound } from 'next/navigation'
import { requireEventId } from '@/features/events/resolve-ref'

import { isEventOrganizer } from '@/features/resources/authorize'
import { resourceFormValues } from '@/features/resources/form'
import { ResourceEditor } from '@/features/resources/ResourceEditor'
import { readAdminResource } from '@/features/resources/reads'

export default async function EditResourcePage({
  params,
}: {
  params: Promise<{ eventId: string; resourceId: string }>
}) {
  const { eventId: eventRef, resourceId } = await params
  const eventId = await requireEventId(eventRef)
  if (!(await isEventOrganizer(eventId))) return null

  const entry = await readAdminResource(eventId, resourceId)
  if (entry === undefined) notFound()

  return (
    <ResourceEditor
      eventId={eventId}
      resourceId={entry.resource.id}
      values={resourceFormValues({
        resource: entry.resource,
        enabled: entry.item?.enabled ?? false,
        // Unused for an existing page, whose own `order` wins. Passed because the shape
        // requires it, and 0 is the value that could not be mistaken for a real position.
        nextOrder: 0,
      })}
    />
  )
}
