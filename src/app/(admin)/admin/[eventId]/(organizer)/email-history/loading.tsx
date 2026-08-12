// The route-level Suspense boundary that lets the admin chrome paint while the outbox read
// streams. Every admin route has one (BUILD_SPEC 6.2).

import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
