// Shared by the page's Suspense boundary and loading.tsx, so a navigation and a streamed
// first render show the same shape.

import { Skeleton } from '@/components/ui/skeleton'

export function EvaluationSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-10 w-56" />
      <Skeleton className="h-8 w-72" />
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  )
}
