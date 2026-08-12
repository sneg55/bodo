// The route-level Suspense boundary that lets the admin shell paint while the plan and the
// queue stream. Every admin route has one (BUILD_SPEC 6.2).

import { EvaluationSkeleton } from './EvaluationSkeleton'

export default function Loading() {
  return <EvaluationSkeleton />
}
