// The Abstracts fallback, shared by the page's Suspense boundary and loading.tsx so a
// navigation and a streamed first render show the same shape. Row heights match the real
// table, so nothing reflows when the data arrives.

import { Skeleton } from '@/components/ui/skeleton'

export function AbstractsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-8 w-full max-w-2xl" />
      <div className="space-y-2 rounded-xl border border-border p-2">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    </div>
  )
}
