// Event Settings > Library > Fields.
//
// URL is flat (`/settings/fields`) rather than nested under `/settings/library/`: the
// parity screenshot shows Fields, Tags and Personas indented under a collapsible Library
// heading in the sub-nav, and it says nothing about the URL. The sub-nav renders them
// nested either way, and a flat tree means one dynamic segment covers every placeholder
// section instead of two.

import { requireEventId } from '@/features/events/resolve-ref'
import { isSettingsOrganizer } from '@/features/settings/authorize'
import { FieldsLibrary } from '@/features/settings/FieldsLibrary'

export const metadata = { title: 'Fields' }

export default async function FieldsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)
  if (!(await isSettingsOrganizer(eventId))) return null
  return <FieldsLibrary />
}
