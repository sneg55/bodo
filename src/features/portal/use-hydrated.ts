'use client'

// Has this tree been hydrated yet?
//
// THE DEFECT it exists for, reproduced by the eval run of 2026-08-11 with a network log: the
// FIRST `Save` on /portal/profile did nothing at all. No toast, no `Saving` state, no
// request of any kind, and the edit gone on reload. An identical second click saved. The
// button was rendered, styled and enabled by server-rendered HTML, and the handler that
// makes it do anything did not exist yet, so the press went into a form with a submit
// handler React had not attached. The profile page is where it bites because the Biography
// editor is a large dynamic chunk, which stretches that window to several seconds, but the
// window exists on any client component and a second agent found the same shape on a tab
// strip. A control that looks ready and is not will be pressed, and its press is lost in
// silence, which is the worst of the three possible outcomes.
//
// `useSyncExternalStore` and NOT a `useState` + `useEffect` mount flag, which is the usual
// version of this. The effect version reports "an effect has run", which is a different
// claim that happens to correlate, and it renders the ready state for one commit before
// correcting itself. This asks React the question directly: the server snapshot is what SSR
// and the hydration render read, the client snapshot is what every render after hydration
// reads, and the store never changes, so there is no subscription to manage.
//
// It belongs beside the surface that needed it. Move it to `src/components/primitives` the
// first time a second feature imports it.

import { useSyncExternalStore } from 'react'

/** Nothing ever changes, so the subscribe callback is never invoked. */
const subscribe = (): (() => void) => {
  return () => {
    // no teardown: there is nothing to unsubscribe from
  }
}

const hydrated = (): boolean => true
const notYet = (): boolean => false

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, hydrated, notYet)
}
