// The visitor's starred sessions, as an EXTERNAL STORE rather than as React state.
//
// WHY THIS EXISTS, and it is a fixed defect rather than a preference. The schedule used to be
// `useState` in `EmbedViewStateProvider`, filled in by a `useEffect` inside its CHILD
// `EmbedScheduleBar`, which read `localStorage` on mount and called the parent's setter. That is
// a child updating a parent's state during the parent's own mount, and React says so out loud:
// `Can't perform a React state update on a component that hasn't mounted yet` was logged on
// every load of /embed/<publicId>. When it fired, the update was dropped, so after a reload the
// widget showed `MY SCHEDULE 0` with every star hollow and `Add to calendar` disabled while the
// ids were sitting in storage the whole time. Clicking any unrelated control re-rendered the
// tree and the stars refilled, which is what a visitor reads as "my selections were wiped, and
// then they came back".
//
// `useSyncExternalStore` removes the mechanism instead of papering over it: React itself reads
// the snapshot as part of hydration and subscribes to the store, so there is no cross-component
// setState to lose and no forced re-render to fake one.
//
// TWO PROPERTIES THE HOOK REQUIRES, and both are the reason this is a module and not four lines
// inline:
//
//   - `getSnapshot` must return the SAME reference until the value really changes, or React
//     re-renders forever. So the parsed array is cached against the raw string it came from.
//   - `getServerSnapshot` must be stable and must describe the SERVER's answer, which is "nothing
//     starred": there is no storage during a render on Workers.
//
// Storage is injected rather than reached for, so every rule here is testable in the node
// environment the suite runs in (tests/cms-schedule-store.test.ts). The default wraps
// `window.localStorage` in try/catch: a browser that partitions third-party storage (Safari's
// ITP), one in private mode with a zero quota, or one whose user has blocked site data throws on
// `getItem` and `setItem`. None of those is worth showing a visitor. The schedule silently
// becomes per-page-view instead of persistent, and the widget keeps working, because an iframe
// that throws on load is a blank rectangle on the conference's own website.

import { readSchedule, writeSchedule } from '@/features/cms/personal-schedule'

/** The two calls this needs off `Storage`, so a test can pass a Map-backed stand-in. */
export type ScheduleStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export type ScheduleStore = {
  subscribe: (onChange: () => void) => () => void
  getSnapshot: () => readonly string[]
  getServerSnapshot: () => readonly string[]
  /** Persist and notify. The one place a schedule is written. */
  set: (ids: readonly string[]) => void
}

/**
 * A frozen empty list, shared.
 *
 * One reference for every "nothing starred" answer, because `getServerSnapshot` returning a
 * fresh `[]` each call is an infinite render loop rather than an empty schedule.
 */
const EMPTY: readonly string[] = Object.freeze([])

/**
 * Thin on purpose: the try/catch lives in the store below, in ONE place, so a storage passed in
 * by a test gets the same protection as the real one. Reaching `window.localStorage` can itself
 * throw (blocked site data) or be a ReferenceError (this module is imported by a client
 * component that Next also renders on the server), and both are caught there.
 */
export function browserScheduleStorage(): ScheduleStorage {
  return {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => {
      window.localStorage.setItem(key, value)
    },
  }
}

/**
 * One store, for one embed's key.
 *
 * `known` is every session id the widget is currently showing, so a session unpublished after
 * somebody starred it leaves their schedule rather than exporting as a VEVENT with no time.
 * Pruning happens on READ and never on write, so an id that is missing only because the visitor
 * is looking at a filtered view is not destroyed by looking at it.
 */
export function createScheduleStore(
  key: string,
  known: readonly string[],
  storage: ScheduleStorage = browserScheduleStorage(),
): ScheduleStore {
  const listeners = new Set<() => void>()
  // The raw string the cached value was parsed from. `undefined` means "nothing read yet",
  // which is distinct from `null`, the value storage returns for an absent key.
  let cachedRaw: string | null | undefined
  let cached: readonly string[] = EMPTY
  /** What the last refused write held, once storage has proved unwritable. See `read`. */
  let memoryRaw: string | undefined

  /**
   * Every storage READ, wrapped once.
   *
   * A browser that partitions third-party storage (Safari's ITP), one in private mode with a
   * zero quota, or one whose user has blocked site data throws here rather than returning null.
   * An unreadable schedule is an empty schedule, not an error: an iframe that throws on load is
   * a blank rectangle on the conference's own website.
   */
  const read = (): string | null => {
    // A refused WRITE promotes the store to memory-backed for the rest of the page view. Without
    // that, a blocked browser reads back the value it failed to write, finds it missing, and the
    // star the visitor just filled empties again on the next render.
    if (memoryRaw !== undefined) return memoryRaw
    try {
      return storage.getItem(key)
    } catch {
      return null
    }
  }

  const snapshot = (): readonly string[] => {
    const raw = read()
    if (raw === cachedRaw) return cached
    cachedRaw = raw
    const parsed = readSchedule(raw, known)
    // Collapsed to the shared reference when empty, so a visitor with nothing starred does not
    // get a new array identity every time the tree re-renders for an unrelated reason.
    cached = parsed.length === 0 ? EMPTY : parsed
    return cached
  }

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  return {
    subscribe: (onChange) => {
      listeners.add(onChange)
      // A `storage` event fires in OTHER documents sharing the origin, never in the one that
      // wrote. Two embeds on one host page are two iframes, so starring in the agenda widget is
      // exactly the case this covers: without it the itinerary beside it keeps a stale count
      // until something else re-renders it. Guarded because this module is imported by a client
      // component that Next also renders on the server.
      const onStorage = (): void => {
        cachedRaw = undefined
        onChange()
      }
      if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
      return () => {
        listeners.delete(onChange)
        if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
      }
    },
    getSnapshot: snapshot,
    getServerSnapshot: () => EMPTY,
    set: (ids) => {
      const raw = writeSchedule(ids)
      try {
        storage.setItem(key, raw)
      } catch {
        // Refused for one of the reasons `read` names. The schedule stays in memory for this
        // page view, which is strictly better than an error the visitor cannot act on.
        memoryRaw = raw
      }
      // Written through the cache rather than re-read, so `set` is correct even against a
      // storage that refused the write: what the visitor just clicked is what they see.
      cachedRaw = raw
      cached = ids.length === 0 ? EMPTY : [...ids]
      notify()
    },
  }
}
