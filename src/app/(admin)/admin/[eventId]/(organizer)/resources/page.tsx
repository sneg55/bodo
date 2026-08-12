// /admin/[eventId]/resources
//
// R8's admin side: the list of resource pages on the event, draft and published.
//
// PRESENTATION IS AUTHORED, NOT TRANSCRIBED. `docs/parity/portal-tasks-forms.md` records
// `Resources` as the fifth entry under the sidebar's PORTALS section and there is no
// screenshot of the page behind it, so there is nothing to copy. What is borrowed is the
// SHAPE of its three captured siblings (Tasks, Forms, File Requests): icon tile, title,
// subtitle, a right-aligned `+ Add`, and a dashed empty-state card whose heading and body
// follow the `No forms yet` / `Create a form to collect information from participants`
// pattern verbatim in form. `docs/parity/cms-embeds.md` is deliberately NOT the model: it
// is P2, SPEC.md line 44 defers every P2 item, and its subject is the CMS embed feed
// rather than a portal page.
//
// One file, not a shell plus a body child inside `<Suspense>`: `loading.tsx` is the
// boundary, and there is no fast half to paint ahead of a two-call read.

import { BookOpenIcon } from 'lucide-react'
import Link from 'next/link'
import { ButtonLink } from '@/components/primitives/ButtonLink'
import { PageHeader } from '@/components/primitives/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { requireEventId } from '@/features/events/resolve-ref'
import { isEventOrganizer } from '@/features/resources/authorize'
import { ResourceRows } from '@/features/resources/ResourceRows'
import { readAdminResources } from '@/features/resources/reads'

export const metadata = { title: 'Resources' }

export default async function ResourcesPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)

  // The layout redirects an unauthorized browser; this is not the security boundary. Every
  // write re-checks the role and the record's event for itself, because a Server Action is
  // reachable without this page ever rendering. BUILD_SPEC 4.
  if (!(await isEventOrganizer(eventId))) return null

  const entries = await readAdminResources(eventId)

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        icon={BookOpenIcon}
        title="Resources"
        description="Create resource pages that speakers can read in the portal"
        actions={<ButtonLink href={`/admin/${eventId}/resources/new`}>+ Add</ButtonLink>}
      />

      {entries.length === 0 ? (
        <EmptyState />
      ) : (
        <ResourceRows
          eventId={eventId}
          rows={entries.map((entry) => ({
            id: entry.resource.id,
            title: entry.resource.title,
            slug: entry.resource.slug,
            visibility: entry.resource.visibility,
            order: entry.resource.order,
            enabled: entry.item?.enabled ?? false,
            hasEmbed: (entry.resource.embedHtml ?? '').trim() !== '',
          }))}
        />
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <BookOpenIcon className="size-6 text-muted-foreground" />
        <p className="font-medium">No resource pages yet</p>
        <p className="text-sm text-muted-foreground">
          Create a resource page to share information with speakers
        </p>
      </CardContent>
    </Card>
  )
}
