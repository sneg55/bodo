// The visitor's starred sessions, as an external store.
//
// This covers the defect the store was written for. The schedule used to live in the provider's
// `useState`, filled in by a `useEffect` in a CHILD, which is a child updating a parent's state
// during the parent's own mount: React logged `Can't perform a React state update on a component
// that hasn't mounted yet` and dropped the update, so a reload rendered `MY SCHEDULE 0` with
// hollow stars over storage that still held the ids.
//
// The two properties `useSyncExternalStore` REQUIRES are what is asserted hardest here, because
// getting either wrong is not a wrong number on screen, it is an infinite render loop:
// `getSnapshot` must return the same reference until the value really changes, and
// `getServerSnapshot` must be constant.

import { describe, expect, it } from 'vitest'

import { createScheduleStore, type ScheduleStorage } from '@/features/cms/schedule-store'

/** A Map-backed stand-in, so the rules are testable in the node environment the suite runs in. */
function fakeStorage(
  initial?: Record<string, string>,
): ScheduleStorage & { raw: Map<string, string> } {
  const raw = new Map(Object.entries(initial ?? {}))
  return {
    raw,
    getItem: (key) => raw.get(key) ?? null,
    setItem: (key, value) => {
      raw.set(key, value)
    },
  }
}

/** Storage that refuses everything, as a browser blocking site data does. */
const blockedStorage: ScheduleStorage = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
}

const KEY = 'bodo:schedule:abc'
const KNOWN = ['s1', 's2', 's3']

describe('the schedule store', () => {
  it('reads what a previous visit wrote, which is the whole defect', () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify(['s2', 's1']) })
    const store = createScheduleStore(KEY, KNOWN, storage)

    // No effect, no mount, no React: the value is available the first time it is asked for.
    expect(store.getSnapshot()).toEqual(['s2', 's1'])
  })

  it('answers nothing starred on the server, from a constant reference', () => {
    const store = createScheduleStore(KEY, KNOWN, fakeStorage({ [KEY]: '["s1"]' }))

    // Not merely equal: `useSyncExternalStore` compares the server snapshot by identity during
    // hydration, and a fresh `[]` each call re-renders forever.
    expect(store.getServerSnapshot()).toBe(store.getServerSnapshot())
    expect(store.getServerSnapshot()).toEqual([])
  })

  it('returns the same reference until the stored value actually changes', () => {
    const storage = fakeStorage({ [KEY]: '["s1"]' })
    const store = createScheduleStore(KEY, KNOWN, storage)

    const first = store.getSnapshot()
    expect(store.getSnapshot()).toBe(first)

    store.set(['s1', 's3'])
    const second = store.getSnapshot()
    expect(second).not.toBe(first)
    expect(second).toEqual(['s1', 's3'])
    expect(store.getSnapshot()).toBe(second)
  })

  it('persists on write, so Clear survives a reload', () => {
    // The old code wrote from the star and NOT from the bar, so `Clear` emptied the list in
    // memory only and the next reload brought every cleared session back.
    const storage = fakeStorage({ [KEY]: '["s1","s2"]' })
    const store = createScheduleStore(KEY, KNOWN, storage)

    store.set([])
    expect(storage.raw.get(KEY)).toBe('[]')
    expect(createScheduleStore(KEY, KNOWN, storage).getSnapshot()).toEqual([])
  })

  it('notifies its subscribers, and stops when they unsubscribe', () => {
    const store = createScheduleStore(KEY, KNOWN, fakeStorage())
    let calls = 0
    const unsubscribe = store.subscribe(() => {
      calls += 1
    })

    store.set(['s1'])
    expect(calls).toBe(1)

    unsubscribe()
    store.set(['s1', 's2'])
    expect(calls).toBe(1)
  })

  it('drops an id whose session has left the agenda', () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify(['s1', 'unpublished']) })
    const store = createScheduleStore(KEY, KNOWN, storage)

    // Pruned on READ and never written back, so a session that returns to the agenda is still
    // starred rather than destroyed by having been looked at while it was away.
    expect(store.getSnapshot()).toEqual(['s1'])
    expect(storage.raw.get(KEY)).toBe(JSON.stringify(['s1', 'unpublished']))
  })

  it('keeps working against storage that throws', () => {
    // Safari's ITP, private mode with a zero quota, blocked site data. An iframe that throws on
    // load is a blank rectangle on the conference's own website.
    const store = createScheduleStore(KEY, KNOWN, blockedStorage)

    expect(store.getSnapshot()).toEqual([])
    expect(() => {
      store.set(['s1'])
    }).not.toThrow()
    // What the visitor just clicked is what they see, even though the write was refused.
    expect(store.getSnapshot()).toEqual(['s1'])
  })
})
