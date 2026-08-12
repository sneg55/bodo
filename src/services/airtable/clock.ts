// A wait that somebody else can cut short, on a runtime where a timer belongs to a request.
//
// Split out of rate-window.ts, which is where both of these were born and which now only
// consumes them. They are their own concern: everything here is about what a `setTimeout`
// means inside a Worker, and nothing here knows what a rate cap is.

/**
 * A wait in progress: the promise to await, and the handle that cuts it short.
 *
 * `wake` is a PLAIN FUNCTION and that is the whole point of this type existing, because
 * the thing it replaced was an `AbortController` and that was a live bug on Workers.
 * The rate window is module scope, so it is shared by every request the isolate is
 * serving, and a refund made by request B would call `abort()` on a controller request A
 * created. workerd refuses that:
 *
 *   Cannot perform I/O on behalf of a different request. I/O objects (such as streams,
 *   request/response bodies, and others) created in the context of one request handler
 *   cannot be accessed from a different request's handler. (I/O type: RefcountedCanceler)
 *
 * Observed on the deployed Worker, thrown out of `settle`, taking a 500 with it through
 * `listMembershipsForUser` and `eventRoleOf` and so through every admin page. Resolving
 * a promise is not I/O and crosses request contexts freely, so a callback does the same
 * job with none of that.
 */
export type Nap = {
  done: Promise<void>
  /** Resolve the wait early. Safe from any request, and a no-op once resolved. */
  wake: () => void
}

export type Clock = {
  now: () => number
  /** A wait of `ms`, resolvable early through the handle it returns. */
  sleep: (ms: number) => Nap
}

/**
 * The real clock.
 *
 * The asymmetry to keep in mind when reading anything that awaits `done`: `wake` works
 * from any request, but the `setTimeout` below does NOT outlive the request that armed
 * it. When that request ends, workerd cancels the timer and `done` is never resolved by
 * the timer again -- only a `wake` from somebody still alive can settle it. That is why
 * the rate window watches its own queue rather than trusting a sleeper to wake up.
 */
export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => {
    let wake: () => void = () => undefined
    const done = new Promise<void>((resolve) => {
      wake = resolve
    })
    // Deliberately never cleared. `clearTimeout` on a timer another request armed is the
    // same cross-context I/O as the `abort()` this replaced, and the cost of leaving it
    // is one callback that resolves an already-resolved promise, which is nothing.
    setTimeout(() => {
      wake()
    }, ms)
    return {
      done,
      wake: () => {
        wake()
      },
    }
  },
}
