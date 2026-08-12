// The speaker-facing list of resource pages.
//
// A server component doing the read, so it can sit inside the portal page's `<Suspense>`
// boundary and the card frame paints first. It renders only what `readPortalResources`
// returns, which is the ENABLED set: a draft page is not filtered out here, it was never in
// the list (@/features/resources/pages).
//
// Nothing here touches `embedHtml`. A list row is a title and a link, so the markup does not
// need to cross into this component at all, and the frame that isolates it lives on the
// detail page.

import { ChevronRightIcon } from 'lucide-react'
import Link from 'next/link'

import { readPortalResources } from '@/features/resources/reads'

export async function PortalResourceList() {
  const resources = await readPortalResources()

  if (resources.length === 0) {
    return <p className="text-sm text-muted-foreground">No resources found.</p>
  }

  return (
    <ul className="divide-y divide-border">
      {resources.map((resource) => (
        <li key={resource.id}>
          <Link
            href={`/portal/resources/${resource.slug}`}
            className="flex items-center gap-2 py-2.5 text-sm hover:underline"
          >
            <span className="min-w-0 flex-1 truncate font-medium">{resource.title}</span>
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
