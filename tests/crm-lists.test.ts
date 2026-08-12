import { describe, expect, it } from 'vitest'

import type { DataTableFilter } from '@/components/primitives/data-table-types'
import {
  applySpeakerList,
  checkListFilters,
  checkListName,
  hasFilters,
  ownedList,
  sanitizeListFilters,
  showingList,
  sortSpeakerLists,
  usableLists,
  visibleLists,
} from '@/features/crm/lists'
import type { SpeakerList } from '@/types/domain'

const list = (id: string, name: string, ownerId: string, isShared = false): SpeakerList => ({
  id,
  name,
  ownerId,
  isShared,
  filters: [],
})

/** One real filter, so a list is a list. `id` is deliberately not `f0`; nothing persists it. */
const COMPANY: DataTableFilter = {
  id: 'stored-7',
  key: 'company',
  operator: 'contains',
  value: 'Acme',
}
const TAGS: DataTableFilter = { id: 'stored-8', key: 'tags', operator: 'is', value: 'Keynote' }

const filtered = (id: string, name: string, filters: readonly DataTableFilter[]): SpeakerList => ({
  id,
  name,
  ownerId: 'usr1',
  isShared: false,
  filters,
})

describe('checkListName', () => {
  it('rejects an empty name', () => {
    expect(checkListName('   ', []).ok).toBe(false)
  })

  it('rejects a duplicate, case-insensitively', () => {
    expect(checkListName('keynotes', [list('l1', 'Keynotes', 'usr1')]).ok).toBe(false)
  })

  it('allows a list to keep its own name while being edited', () => {
    expect(checkListName('Keynotes', [list('l1', 'Keynotes', 'usr1')], 'l1').ok).toBe(true)
  })

  it('rejects a name past 255 characters', () => {
    expect(checkListName('x'.repeat(256), []).ok).toBe(false)
  })

  it('accepts a name of exactly 255 characters', () => {
    expect(checkListName('x'.repeat(255), []).ok).toBe(true)
  })

  it('gives a reason a person can act on', () => {
    const result = checkListName('keynotes', [list('l1', 'Keynotes', 'usr1')])
    expect(result.ok === false && result.reason.length > 0).toBe(true)
  })
})

describe('visibleLists', () => {
  it('shows your own lists and shared ones, but not other people private lists', () => {
    const lists = [
      list('l1', 'Mine', 'usr1'),
      list('l2', 'Theirs', 'usr2'),
      list('l3', 'Shared', 'usr2', true),
    ]
    expect(visibleLists(lists, 'usr1').map((l) => l.id)).toEqual(['l1', 'l3'])
  })

  it('hides an ownerless private list from everybody', () => {
    const orphan: SpeakerList = { id: 'l9', name: 'Orphan', isShared: false, filters: [] }
    expect(visibleLists([orphan], 'usr1')).toEqual([])
  })
})

describe('ownedList', () => {
  it('finds a list the caller owns', () => {
    const lists = [list('l1', 'Mine', 'usr1')]
    expect(ownedList(lists, 'l1', 'usr1')?.id).toBe('l1')
  })

  it('refuses a shared list owned by somebody else', () => {
    const lists = [list('l3', 'Shared', 'usr2', true)]
    expect(ownedList(lists, 'l3', 'usr1')).toBeUndefined()
  })

  it('refuses a list with no owner at all', () => {
    const orphan: SpeakerList = { id: 'l9', name: 'Orphan', isShared: true, filters: [] }
    expect(ownedList([orphan], 'l9', 'usr1')).toBeUndefined()
  })

  it('refuses an id that is not on the list at all', () => {
    expect(ownedList([list('l1', 'Mine', 'usr1')], 'l2', 'usr1')).toBeUndefined()
  })
})

describe('sortSpeakerLists', () => {
  it('orders by name, case insensitively, without mutating the input', () => {
    const lists = [list('l1', 'zulu', 'usr1'), list('l2', 'Alpha', 'usr1')]
    expect(sortSpeakerLists(lists).map((l) => l.name)).toEqual(['Alpha', 'zulu'])
    expect(lists.map((l) => l.name)).toEqual(['zulu', 'Alpha'])
  })
})

describe('sanitizeListFilters', () => {
  it('drops an entry with no key and one with an operator outside the vocabulary', () => {
    const filters = [
      { id: 'a', key: '', operator: 'is', value: 'x' },
      { id: 'b', key: 'company', operator: 'nonsense', value: 'x' },
      { id: 'c', key: 'company', operator: 'contains', value: 'Acme' },
    ] as readonly DataTableFilter[]
    expect(sanitizeListFilters(filters)).toEqual([
      { id: 'f0', key: 'company', operator: 'contains', value: 'Acme' },
    ])
  })

  it('caps how many filters one list may store', () => {
    const many = Array.from({ length: 80 }, (_, index) => ({
      id: `x${String(index)}`,
      key: 'company',
      operator: 'is' as const,
      value: String(index),
    }))
    expect(sanitizeListFilters(many)).toHaveLength(50)
  })
})

// A list is a filter set, so a list that stores none is not a list. The defect this covers:
// `showingList` said an empty stored set matched an unfiltered table, so on a plain
// /admin/crm the first zero-filter list was silently selected, which armed Delete, Rename
// and Update against a list nobody picked, and made `All speakers` unselectable.
describe('the empty filter set', () => {
  const empty = filtered('l0', 'Everyone', [])
  const real = filtered('l1', 'Acme', [COMPANY])

  it('does not count as showing, even against an unfiltered table', () => {
    expect(showingList(empty, [])).toBe(false)
  })

  it('is what would otherwise capture the default view of the directory', () => {
    // The whole bug in one line: with no filters in the URL, nothing may be applied.
    expect([empty, real].some((candidate) => showingList(candidate, []))).toBe(false)
  })

  it('counts a list whose stored filters are ALL dropped by sanitation as empty too', () => {
    const degraded = filtered('l2', 'Broken', [{ id: 'x', key: '', operator: 'is', value: 'v' }])
    expect(hasFilters(degraded)).toBe(false)
    expect(showingList(degraded, [])).toBe(false)
  })

  it('is refused before it can be saved, with a reason naming the fix', () => {
    const result = checkListFilters([])
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('at least one filter')
  })

  it('accepts a set with one real filter', () => {
    expect(checkListFilters([COMPANY])).toEqual({ ok: true })
  })

  it('is kept out of the APPLY path by usableLists', () => {
    expect(usableLists([empty, real]).map((entry) => entry.id)).toEqual(['l1'])
  })

  it('is still OWNED, so its owner can reach it to delete it', () => {
    // The reason `SpeakerListPicker` lists empty rows under `Empty lists` instead of hiding
    // them: the build before this rule created them from `Save current filters...` on an
    // unfiltered table, so real bases hold them, and deleting needs no filters. Hiding them
    // everywhere made them undeletable through the app.
    expect(ownedList([empty], empty.id, 'usr1')?.id).toBe('l0')
  })

  it('is one definition, not two: hasFilters defers to checkListFilters', () => {
    for (const candidate of [
      [],
      [COMPANY],
      [{ id: 'x', key: '', operator: 'is' as const, value: 'v' }],
    ]) {
      expect(hasFilters(filtered('lx', 'X', candidate))).toBe(checkListFilters(candidate).ok)
    }
  })
})

describe('showingList', () => {
  const real = filtered('l1', 'Acme', [COMPANY])

  it('matches the table showing exactly what the list stores, ignoring filter ids', () => {
    expect(showingList(real, [{ ...COMPANY, id: 'f0' }])).toBe(true)
  })

  it('does not match when the table is showing more', () => {
    expect(
      showingList(real, [
        { ...COMPANY, id: 'f0' },
        { ...TAGS, id: 'f1' },
      ]),
    ).toBe(false)
  })

  it('does not match when the table is showing fewer', () => {
    expect(showingList(filtered('l2', 'Both', [COMPANY, TAGS]), [{ ...COMPANY, id: 'f0' }])).toBe(
      false,
    )
  })

  it('does not match on a different value, operator, or key', () => {
    expect(showingList(real, [{ ...COMPANY, value: 'Other' }])).toBe(false)
    expect(showingList(real, [{ ...COMPANY, operator: 'is' }])).toBe(false)
    expect(showingList(real, [{ ...COMPANY, key: 'tagline' }])).toBe(false)
  })

  it('is order sensitive, because filters are read top to bottom', () => {
    const both = filtered('l3', 'Both', [COMPANY, TAGS])
    expect(showingList(both, [TAGS, COMPANY])).toBe(false)
    expect(showingList(both, [COMPANY, TAGS])).toBe(true)
  })

  it('agrees with applySpeakerList: applying a list makes it the one showing', () => {
    const both = filtered('l4', 'Both', [COMPANY, TAGS])
    expect(showingList(both, applySpeakerList(both))).toBe(true)
  })
})

describe('applySpeakerList', () => {
  it('renumbers ids so a stored list compares equal to itself once applied', () => {
    const stored: SpeakerList = {
      id: 'l1',
      name: 'Keynotes',
      ownerId: 'usr1',
      isShared: false,
      filters: [{ id: 'stored-7', key: 'company', operator: 'is', value: 'Acme' }],
    }
    expect(applySpeakerList(stored)).toEqual([
      { id: 'f0', key: 'company', operator: 'is', value: 'Acme' },
    ])
  })
})
