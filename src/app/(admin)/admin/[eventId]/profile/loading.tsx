// The route-level Suspense boundary that lets the admin shell paint while the team read
// behind this page streams. Every admin route has one (BUILD_SPEC 6.2), and the skeleton
// heights match the real header and the two fields so nothing reflows when the data lands.
//
// Safe here, unlike under `crm/`: this page cannot 404. It resolves the acting user from the
// session and renders blank fields rather than calling `notFound()`, so there is no status
// line for this boundary to have already sent.

import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      </div>
      <div className="flex max-w-xl flex-col gap-5">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full rounded-lg" />
          <Skeleton className="h-3 w-full max-w-md" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3 w-full max-w-md" />
        </div>
        <Skeleton className="h-9 w-20 rounded-lg" />
      </div>
    </div>
  )
}
