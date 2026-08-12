// The served embed, at /embed/<publicId>. R9's real deliverable.
//
// This is what ref 33's preview is a preview OF, and what the "Get Code" snippet points at. It is
// deliberately UNAUTHENTICATED, because the whole point is that it renders inside a page this app
// does not control, and it exposes exactly what `/agenda/<slug>` already exposes: the event's name
// and its published, accepted, uncancelled sessions with their speakers, rooms and tracks. It is
// addressed by the opaque `publicId` and never by a record id, and the projection is handed only
// the event's name and timezone, so no internal id leaves the server (@/features/cms/reads).
//
// THE 404 IS THE PART TO READ CAREFULLY. An unknown id and a DISABLED embed must both answer a real
// 404, and on Workers that constrains where the check can happen:
//
//   - `readServedEmbed` is awaited in this page's BODY, not inside a `<Suspense>` boundary. A
//     `notFound()` reached from inside a boundary resolves after the shell has already flushed, so
//     the status line is long gone and the response is HTTP 200 carrying the 404 body. For an
//     embed that is the worst possible failure: a stranger's website would render our not-found
//     copy inside their layout, at 200, forever cacheable, with nothing logged.
//   - There is therefore NO `loading.tsx` in this segment, because a route-level `loading.tsx` is
//     itself such a boundary and would defeat a correctly placed `notFound()` below it. The public
//     agenda page had exactly this bug. The cost is that the whole page waits on the reads, which
//     is the right trade for an iframe: there is no chrome worth painting early, and every read is
//     tagged and served from the Data Cache.
//   - There is no `<Suspense>` inside the page either, for the same reason.
//
// Unknown and disabled are answered IDENTICALLY, and that is a decision rather than a shortcut: a
// distinguishable response would let anybody walk the id space and learn which embeds exist and
// which an organizer has switched off.

import { notFound, redirect } from 'next/navigation'

import { parseEmbedDeepLink } from '@/features/cms/deep-link'
import { EmbedFrame } from '@/features/cms/EmbedFrame'
import { EmbedSurface } from '@/features/cms/EmbedSurface'
import { readEmbedFormat } from '@/features/cms/feed-read'
import { readServedEmbed } from '@/features/cms/reads'
import { embedFormatPath } from '@/features/cms/snippet'

export const metadata = {
  title: 'Embed',
  // Not indexable. The canonical page for this content is the event's own website, which is where
  // this markup is meant to appear; a search result pointing at a bare iframe body is a worse
  // answer to the same query and would compete with the organizer's page.
  robots: { index: false, follow: false },
}

export default async function ServedEmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ publicId }, query] = await Promise.all([params, searchParams])

  // An embed whose Format is not `Styled HTML` is served by a route handler with a content type,
  // which a page cannot set, so this URL sends the reader to that embed's own address rather than
  // rendering the styled page for a feed the organizer did not ask for. IN THE BODY, before the
  // first byte and outside any `<Suspense>`, for the same reason `notFound()` is: a redirect
  // resolved after the shell has flushed never produces a response and the Workers runtime
  // cancels the request. `readEmbedFormat` answers `undefined` for a disabled embed, so a
  // switched-off feed falls through to the 404 below instead of confirming it exists.
  const format = await readEmbedFormat(publicId)
  if (format !== undefined && format !== 'styled_html') {
    redirect(embedFormatPath(publicId, format, parseEmbedDeepLink(query)))
  }

  // Both `undefined` cases (no such embed, embed disabled) land here, before the first byte.
  const projection = await readServedEmbed(publicId, query)
  if (projection === undefined) notFound()

  return (
    <EmbedFrame projection={projection}>
      {/* The controls, the layout and the state that joins them, shared with the public event
          site so the two cannot drift (@/features/cms/EmbedSurface). Keyed by `publicId`, so
          two embeds on one host page keep separate starred sessions. */}
      <EmbedSurface projection={projection} stateKey={publicId} />
    </EmbedFrame>
  )
}
