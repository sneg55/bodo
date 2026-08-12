// The Suspense boundary for the import wizard, more specific than the Integrations one.
//
// Its own file because the parent's `loading.tsx` is shaped like three provider rows over
// two wide tables, and this route is a step rail beside one form. A skeleton whose shape is
// wrong is worse than none: the layout visibly jumps when the real content replaces it.
//
// The documented cost of a boundary above a page applies here and is accepted
// (.claude/rules/bodo-conventions.md): the page resolves the `[source]` segment and calls
// `notFound()` for an unknown one, and because the shell has already flushed that answers
// HTTP 200 with the 404 body. Nothing is disclosed by it, and the alternative is losing the
// admin chrome painting while the page resolves.

import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>

      <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-11 w-full rounded-md" />
          ))}
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-9 w-full max-w-lg rounded-md" />
          <Skeleton className="h-24 w-full max-w-lg rounded-lg" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      </div>
    </div>
  )
}
