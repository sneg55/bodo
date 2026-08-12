// The route-level Suspense boundary that lets the admin shell paint while the request list and
// the delivery table stream. Every admin route has one (BUILD_SPEC 6.2). Shapes match the real
// surface, so nothing reflows when the data arrives.

import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-14 w-full max-w-3xl" />
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-full max-w-sm" />
        <Skeleton className="h-8 w-24" />
      </div>
      <Skeleton className="h-8 w-96 max-w-full" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 2 }, (_, index) => (
          <Skeleton key={index} className="h-28 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}
