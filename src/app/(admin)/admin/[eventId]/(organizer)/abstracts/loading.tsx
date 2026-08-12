// The route-level Suspense boundary that lets the admin shell paint while the table
// streams. Every admin route has one (BUILD_SPEC 6.2).

import { AbstractsSkeleton } from './AbstractsSkeleton'

export default function Loading() {
  return <AbstractsSkeleton />
}
