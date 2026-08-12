// The route-level Suspense boundary for the import wizard, so the admin chrome paints while
// the page reads the viewer's events for the target picker. Every admin route has one
// (BUILD_SPEC 6.2).
//
// SAFE HERE, and it is worth saying why rather than assuming it, because the sibling route
// `crm/[speakerId]` had to give its own boundary up: a `loading.tsx` IS a Suspense boundary,
// and a `notFound()` raised behind one renders the 404 page after the status line has gone
// out, so the response is HTTP 200 carrying the 404 body. `page.tsx` beside this file calls
// no `notFound()` and has no id that can miss - the only 404 in this subtree is the layout's,
// for a viewer with no membership at all, and that one is raised in the LAYOUT body, above
// this boundary and before the first byte. Verified on the running server: `/admin/crm/import`
// answers 200 and `/admin/crm/recNope` still answers 404.
//
// Shapes match the wizard next to it: the page header, the step strip, the progress bar, then
// the step card, so nothing reflows on arrival.

import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-10 w-72" />
      <div className="flex flex-wrap items-center gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-8 w-28" />
        ))}
      </div>
      <Skeleton className="h-2 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
