// The route-level Suspense boundary for every settings section.
//
// One file for the whole subtree: the header band and the sub-nav live in `layout.tsx`
// and paint immediately, so this only stands in for the section body while its read
// streams. Skeleton heights match the Event Details grid, which is the heaviest section.
//
// The cost is the documented one in .claude/rules/bodo-conventions.md: a boundary above a
// page defeats a `notFound()` called inside it, so `/settings/<unknown>` answers 200 with
// the 404 body. Accepted here for the same reason the rest of the admin tree accepts it,
// and the only route that can 404 is the placeholder section list.

import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-9 w-20" />
    </div>
  )
}
