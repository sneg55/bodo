// The route-level Suspense boundary for the CRM dashboard, so the admin chrome paints while
// the cross-event reads stream. Every admin route has one (BUILD_SPEC 6.2).
//
// SAFE HERE, and the rule it has to clear is worth stating rather than assumed. A
// `loading.tsx` is a Suspense boundary, and a `notFound()` raised behind one answers HTTP 200
// with the 404 body, which is why the sibling `crm/[speakerId]` route has none and why the
// directory's lives inside the `(directory)` group. This route has no dynamic segment and no
// `notFound()` anywhere below it: `/admin/crm/dashboard` either renders or throws, and the
// only 404 in this tree is the layout's, raised in the layout BODY above this boundary, so its
// status line goes out before anything here is reached.
//
// Shapes match the page: the header, one row of four tiles, then the widget grid.

import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-10 w-72" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-60 w-full" />
        ))}
      </div>
    </div>
  )
}
