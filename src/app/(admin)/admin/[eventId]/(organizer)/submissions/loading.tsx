// The route-level Suspense boundary that lets the admin shell paint while the table
// streams. Every admin route has one (BUILD_SPEC 6.2). Same skeleton as Abstracts, because
// it is the same table.

import { AbstractsSkeleton } from '../abstracts/AbstractsSkeleton'

export default function Loading() {
  return <AbstractsSkeleton />
}
