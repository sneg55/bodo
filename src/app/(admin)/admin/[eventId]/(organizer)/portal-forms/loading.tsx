// The route-level Suspense boundary that lets the admin shell paint while the form list streams.
// Every admin route has one (BUILD_SPEC 6.2). Shapes match the real surface, so nothing reflows
// when the data arrives.

import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-10 w-72" />
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-full max-w-sm" />
        <Skeleton className="h-8 w-24" />
      </div>
      <Skeleton className="h-8 w-96 max-w-full" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}
