// What both Files routes show while their read streams. Shared, because the two lists are
// the same table and a different skeleton per route would flash a different shape.

import { Skeleton } from '@/components/ui/skeleton'

export function FilesSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-9 w-full" />
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <Skeleton key={row} className="h-11 w-full" />
        ))}
      </div>
    </div>
  )
}
