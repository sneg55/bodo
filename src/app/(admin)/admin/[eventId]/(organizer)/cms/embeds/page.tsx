// /admin/[eventId]/cms/embeds
//
// Ref 32. The page header is transcribed: a code-brackets icon in a rounded tile, the title
// "Embeds", and the subtitle "Export a feed of your agenda, sessions, or speakers to place in your
// app or website." verbatim. Everything below it (the search box, the segmented status filter, the
// "+ Add Embed" button and the grouped card list) is `EmbedsSurface`, which is a client component
// because all three controls are local state over a list that is already here.
//
// One file, not a shell plus a body child inside `<Suspense>`: `loading.tsx` one segment up is the
// boundary, and there is no fast half to paint ahead of a single list read.

import { CodeXmlIcon } from 'lucide-react'
import { PageHeader } from '@/components/primitives/PageHeader'
import { isEventOrganizer } from '@/features/cms/authorize'
import { EmbedsSurface } from '@/features/cms/EmbedsSurface'
import { readEmbeds } from '@/features/cms/reads'
import { requireEventId } from '@/features/events/resolve-ref'

export const metadata = { title: 'Embeds' }

export default async function EmbedsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)
  if (!(await isEventOrganizer(eventId))) return null

  const embeds = await readEmbeds(eventId)

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        icon={CodeXmlIcon}
        title="Embeds"
        description="Export a feed of your agenda, sessions, or speakers to place in your app or website."
      />

      <EmbedsSurface eventId={eventId} embeds={embeds} />
    </div>
  )
}
