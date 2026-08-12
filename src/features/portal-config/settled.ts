// A portal Server Action call that cannot reject, for the client components that await one.
//
// WHY THIS EXISTS, and it is not defensive programming for its own sake. Every handler on
// these screens is shaped `setPending(true)` then `await someAction(...)` then branch on
// `result.ok`. That shape assumes the call RESOLVES. A Server Action can also reject, and
// two of the ways it does are not exotic:
//
//   - the action's module fails to evaluate, so the POST is a 500 before any of the code in
//     it runs. This happened, on the deployed Worker, to all six portal actions at once
//     (../portal-config/actions.ts records the line);
//   - the request never completes, because the browser is offline or the isolate cancelled
//     it mid-flight.
//
// In both cases the rejection lands in an `async` callback nobody catches. React does not
// surface it, `setPending(false)` on the happy path is never reached, and the screen is left
// with its buttons disabled and no message: the create wizard sat on a dead `+ Create Portal`
// indefinitely, and a second click sent nothing. A user cannot tell that from a slow save.
//
// So the rule for this feature: every action call goes through `settled`, and the handler
// keeps its single `result.ok` branch. A transport failure becomes a refusal with a sentence,
// which every one of these screens already knows how to show.
//
// It deliberately does NOT say "nothing was saved". A 500 raised after the write committed is
// indistinguishable from one raised before it, from here. Telling somebody their change was
// discarded when it landed is worse than telling them to look.

import type { PortalActionResult } from '@/features/portal-config/invariants'

/** Await a portal action, turning a rejection into the refusal shape the callers branch on. */
export async function settled(call: Promise<PortalActionResult>): Promise<PortalActionResult> {
  try {
    return await call
  } catch {
    return {
      ok: false,
      error: 'The server did not answer. Reload the page to see whether it went through.',
    }
  }
}
