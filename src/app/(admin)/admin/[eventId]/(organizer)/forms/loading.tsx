// The Suspense boundary for the forms list. Every admin route has one: it is what lets
// the admin chrome paint while the page's Airtable reads are still in flight.

import { Skeleton } from '@/components/ui/skeleton'

export default function FormsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Skeleton className="size-8 rounded-lg" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-80" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="ml-auto h-8 w-44" />
      </div>
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="h-20 w-full rounded-xl" />
      ))}
    </div>
  )
}
