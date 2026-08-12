'use client'

// The freshness half of SPEC.md R6's acceptance criterion, and BUILD_SPEC 5.6 asks for it in
// exactly these terms.
//
// Tag invalidation cannot deliver "the dashboard shows that speaker at 1/3 done without a
// manual refresh" on its own. `completeTaskAssignment` expires `event:{id}:tasks`, so the
// NEXT request renders 1/3, but an admin sitting on an already-painted page makes no next
// request. `router.refresh()` is what makes one, and it is the correct call here for the
// reason BUILD_SPEC 6.1 gives for it being the wrong call after a mutation: it reruns the
// client router against the server, and the server read is served from a cache entry the
// speaker's write has already expired.
//
// Visibility-aware, so a backgrounded tab costs nothing, and this is the only polling in the
// app. One RSC request per 10s per open dashboard is the whole cost, which is why it is
// scoped to this surface rather than put in a layout.

import { useRouter } from 'next/navigation'
import { useEffect, useTransition } from 'react'

const INTERVAL_MS = 10_000

export type ProgressPollerProps = {
  /**
   * Whether there is still something to wait for.
   *
   * Defaults to true, which is what the two task surfaces want: a speaker can complete a
   * to-do at any moment, so an admin watching them is never done waiting. The AI pre-screen
   * is the opposite, a queue that drains and stops, and it passes false the moment nothing
   * is outstanding rather than refreshing a settled page every ten seconds forever.
   */
  enabled?: boolean
}

export function ProgressPoller({ enabled = true }: ProgressPollerProps) {
  const router = useRouter()
  // The overlap guard. `router.refresh()` returns nothing to await, so the only way to know
  // a refresh is still in flight is to run it inside a transition and read `isPending`. On a
  // slow request the 10s ticks would otherwise pile refreshes on top of each other, and each
  // one is a full server render of a page with several Airtable-backed reads behind it.
  // Found by Codex review.
  const [refreshing, startRefresh] = useTransition()

  useEffect(() => {
    if (!enabled || refreshing) return undefined
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        startRefresh(() => {
          router.refresh()
        })
      }
    }, INTERVAL_MS)

    return () => clearInterval(timer)
  }, [router, refreshing, enabled])

  return null
}
