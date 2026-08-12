// Has React finished hydrating this tree yet?
//
// Its own module because it is the one rule three surfaces now share, and because
// `EmbedViewState.tsx` is at its 300-line budget. Nothing here is embed-specific: any client
// island on a slow public page can read it.
//
// WHY IT EXISTS, and it is a filed defect on three surfaces rather than caution. These pages send
// server markup immediately and hydrate two to six seconds later, and in that window every control
// is on screen, looks ready, and does nothing. The eval run recorded all three shapes of it: a
// returning visitor shown `MY SCHEDULE 0` with a disabled export and no filled stars over storage
// that still held their picks, a tab strip that swallowed its first click, and a Save button that
// no-opped once. None of those is missing data. Each is a control ASSERTING a value it does not
// have yet.
//
// So the rule on those surfaces is: while this is false, nothing renders a confident answer and
// nothing renders a control that looks pressable. A skeleton says "not yet", which is true, and a
// click on a skeleton is a click the visitor never made.

import { useSyncExternalStore } from 'react'

/**
 * A store that never changes, subscribed to by nobody.
 *
 * Module scope because `useSyncExternalStore` holds these by identity: a `subscribe` recreated per
 * render resubscribes on every render, and a `getSnapshot` that returns a fresh value each call is
 * an infinite render loop rather than a signal.
 */
const UNSUBSCRIBE = (): void => {
  // Nothing to tear down: the store has no listeners because its value never changes.
}
const NEVER_CHANGES = (): (() => void) => UNSUBSCRIBE
const ON_CLIENT = (): boolean => true
const ON_SERVER = (): boolean => false

/**
 * False for the server render AND for the hydration render that has to match it; true from the
 * commit after hydration onwards.
 *
 * `useSyncExternalStore` and not a `useEffect` flag, for the same reason the starred schedule is a
 * store (`schedule-store.ts` says it at length): React reads `getServerSnapshot` for the server
 * render and again for the hydration render that must match it, then re-reads `getSnapshot` once
 * hydration commits. There is no effect to be dropped and no markup mismatch to warn about, and
 * this flips in the same commit as anything else read the same way, so a count and the stars
 * beside it can never disagree about whether the store has been read.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(NEVER_CHANGES, ON_CLIENT, ON_SERVER)
}
