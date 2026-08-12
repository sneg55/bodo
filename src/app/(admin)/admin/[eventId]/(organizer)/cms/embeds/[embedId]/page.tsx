// /admin/[eventId]/cms/embeds/[embedId]
//
// Ref 33's two-pane editor. `readEmbedEditor` resolves the record out of THIS event's list rather
// than by id alone, so a record id belonging to another event is a 404 here rather than an editable
// page: the read repeats the event scoping every write does in `ownedEmbed` (@/features/cms/actions
// and ./authorize), because a page and an action are separate entry points.
//
// `notFound()` is called from the page BODY, before the first byte. A `notFound()` from inside a
// `<Suspense>` boundary resolves after the shell has flushed, which on Workers answers HTTP 200
// with the 404 body. The known cost recorded in .claude/rules/bodo-conventions.md applies to every
// admin `[id]` route and to this one: the `loading.tsx` one segment up is itself such a boundary,
// so a bogus embed id here still answers 200 with the 404 body. That is accepted for the admin
// tree, where the visitor is a signed-in organizer who mistyped a URL. It is NOT accepted for the
// public embed route, which has no `loading.tsx` for exactly this reason.

import { notFound } from 'next/navigation'
import { isEventOrganizer } from '@/features/cms/authorize'
import { EmbedEditor } from '@/features/cms/EmbedEditor'
import { readEmbedEditor } from '@/features/cms/reads'
import { requireEventId } from '@/features/events/resolve-ref'
import { appUrl } from '@/utils/env'

export const metadata = { title: 'Embed' }

export default async function EmbedEditorPage({
  params,
}: {
  params: Promise<{ eventId: string; embedId: string }>
}) {
  const { eventId: eventRef, embedId } = await params
  const eventId = await requireEventId(eventRef)
  if (!(await isEventOrganizer(eventId))) return null

  const data = await readEmbedEditor(eventId, embedId)
  if (data === undefined) notFound()

  return (
    <EmbedEditor
      eventId={eventId}
      embed={data.embed}
      // Built off this event's tracks, rooms, tags and published rows, so the Filters section offers
      // values that exist rather than a vocabulary restated in the client bundle.
      filterGroups={data.filterGroups}
      // Resolved on the server from APP_URL. The preview and the snippet must not guess the
      // origin from `window.location`: the admin may be on a preview deployment while the embed
      // URL an organizer copies has to be the one their website will load.
      origin={appUrl()}
    />
  )
}
