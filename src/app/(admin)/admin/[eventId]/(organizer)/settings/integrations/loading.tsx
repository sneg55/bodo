// The Suspense boundary for this section, more specific than the settings-wide one.
//
// Its own file because the parent's `loading.tsx` is shaped like the Event Details grid,
// which is eight labelled inputs, and this page is three provider rows over two wide
// tables. A skeleton whose shape is wrong is worse than none: the layout visibly jumps when
// the real content replaces it.
//
// The cost is the documented and accepted one for the admin tree
// (.claude/rules/bodo-conventions.md): a boundary above a page defeats a `notFound()`
// called inside it. Nothing here calls one, because this route resolves no id of its own.

import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>

      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-40 w-full rounded-xl" />
        ))}
      </div>

      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  )
}
