// The public agenda, at /agenda/<event-slug>. The index of the event's own public site.
//
// This is the reader for Publish Agenda. Until it existed, `scheduleStatus: 'published'` was a
// write nothing rendered, so the control in /admin/[eventId]/agenda changed nothing a visitor
// could see.
//
// IT IS NO LONGER A STATIC STACK OF DAY SECTIONS. It rendered both event days as fixed sections
// with no search box, no facet filters, no day navigation and no clickable session, while the
// embed widgets built on the identical rows had all four: an accessibility snapshot of this page
// listed zero interactive controls. It now renders the same `EmbedSurface` an embed does
// (@/features/cms/PublicSitePage), so there is one implementation of a public schedule rather
// than two that drift.
//
// The slug is resolved HERE, in the page body, and not inside the `<Suspense>` the shell renders.
// `notFound()` from inside a boundary never produces a response on Workers: the boundary resolves
// after the shell has flushed and the runtime cancels the request. So the one read that can 404
// happens before the first byte, and only the schedule streams.

import { notFound } from 'next/navigation'

import { PublicSitePage } from '@/features/cms/PublicSitePage'
import { publicSiteSurface } from '@/features/cms/public-site'
import { getEventBySlug } from '@/services/airtable/queries'

export const metadata = {
  title: 'Agenda',
}

export default async function PublicAgendaPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ eventSlug }, query] = await Promise.all([params, searchParams])
  const event = await getEventBySlug(eventSlug)
  if (event === undefined) notFound()

  // The empty segment is the site index, and it is looked up rather than written out so the nav,
  // the title and the view all come from the one surface table.
  const surface = publicSiteSurface('')
  if (surface === undefined) notFound()

  return <PublicSitePage event={event} surface={surface} params={query} />
}
