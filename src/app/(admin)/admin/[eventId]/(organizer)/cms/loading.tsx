// The route-level Suspense boundary that lets the admin shell paint while the CMS reads stream.
// Every admin route has one (BUILD_SPEC 6.2).
//
// This segment has no `page.tsx` of its own, and the file stays because a `loading.tsx` covers
// the segments BELOW it: both Embeds pages render against this skeleton, which is the shape
// they share (an icon tile, a title, a subtitle, and a stack). `/cms` itself answers 404 now,
// which is correct, since the CMS section is Embeds and the sidebar links straight to it.

import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    </div>
  )
}
