// The route-level Suspense boundary that lets the admin chrome paint while the CRM's
// cross-event speaker read streams. Every admin route has one (BUILD_SPEC 6.2).
//
// Shapes match the directory next to it: title, toolbar, then table rows, so nothing
// reflows on arrival.
//
// IT LIVES IN A ROUTE GROUP, and that is the whole reason `(directory)` exists. This file
// used to sit one level up, at `crm/loading.tsx`, where it covered the segment and every
// route nested under it. A `loading.tsx` IS a Suspense boundary, and a `notFound()` raised
// behind one renders the 404 page after the status line has already gone out: the response
// is HTTP 200 carrying the 404 body. So the sibling profile route at `crm/[speakerId]`,
// whose id can legitimately not exist, answered 200 for an unknown speaker. Measured on
// the running server, not inferred: moving this file into the group flipped that route
// from 200 to a real 404 and left `/admin/crm` unchanged at 200 with its skeleton.
//
// A route group changes the boundary hierarchy without changing a URL, so `/admin/crm`
// still keeps its skeleton and `/admin/crm/[speakerId]` is no longer inside it. Any future
// route under `crm/` that can 404 must stay OUT of this group.

import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-10 w-72" />
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-full max-w-sm" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 10 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    </div>
  )
}
