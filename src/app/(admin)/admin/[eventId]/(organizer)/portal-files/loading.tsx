// The route-level Suspense boundary that lets the admin shell paint while the list
// streams. Every admin route has one (BUILD_SPEC 6.2).

import { FilesSkeleton } from '@/features/files/FilesSkeleton'

export default function Loading() {
  return <FilesSkeleton />
}
