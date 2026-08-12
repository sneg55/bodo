// Saved speaker lists: create, delete, and the shared-list visibility fix. Split out of
// tests/crm-mutations.test.ts, which was over the line limit.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSpeakersApi } from './helpers/fake-speakers-api'

const revalidateTag = vi.hoisted(() => vi.fn())

vi.mock('next/cache', () => ({ revalidateTag }))

const ORIGINAL_ENV = { ...process.env }

async function load(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  process.env = { ...ORIGINAL_ENV, AIRTABLE_TOKEN: 'patTest', AIRTABLE_BASE_ID: 'appTest' }
  vi.resetModules()
  vi.stubGlobal('fetch', fetchImpl)
  return {
    crm: await import('@/services/airtable/mutations-crm'),
    reads: await import('@/services/airtable/reads-crm'),
  }
}

beforeEach(() => {
  revalidateTag.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL_ENV }
})

describe('saveSpeakerList and deleteSpeakerList', () => {
  it('creates a list and expires the owner list tag', async () => {
    const { crm } = await load(fakeSpeakersApi().fetchImpl)

    const list = await crm.saveSpeakerList('action', {
      name: 'Keynotes',
      ownerId: 'recUsr1',
      isShared: false,
      filters: [],
    })

    expect(list).toMatchObject({ name: 'Keynotes', ownerId: 'recUsr1', isShared: false })
    // Both the owner's own tag and the shared-list dimension, unconditionally: see
    // sharedSpeakerListsTag's doc in tags.ts.
    expect(revalidateTag.mock.calls.map((call): unknown => call[0])).toEqual([
      'user:recUsr1:speaker-lists',
      'speaker-lists:shared',
    ])
  })

  it('deletes a list and expires its owner tag plus the shared-list tag', async () => {
    const api = fakeSpeakersApi({
      initial: { SpeakerLists: [{ id: 'recList1', fields: { name: 'Old' } }] },
    })
    const { crm } = await load(api.fetchImpl)

    await crm.deleteSpeakerList('action', 'recList1', 'recUsr1')

    expect(api.rows('SpeakerLists')).toHaveLength(0)
    expect(revalidateTag.mock.calls.map((call): unknown => call[0])).toEqual([
      'user:recUsr1:speaker-lists',
      'speaker-lists:shared',
    ])
  })

  it('another user sees a shared list disappear after its owner deletes it', async () => {
    // The bug fix 4 exists for: `listSpeakerLists` reads the whole table but only tags its
    // own caller's entry; without `sharedSpeakerListsTag` a delete by A would not expire
    // B's cached view, and B would keep seeing a row that no longer exists.
    const api = fakeSpeakersApi({
      initial: {
        SpeakerLists: [{ id: 'recList1', fields: { name: 'Shared', isShared: true } }],
      },
    })
    const { crm } = await load(api.fetchImpl)

    await crm.deleteSpeakerList('action', 'recList1', 'recUsrA')

    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toContain('speaker-lists:shared')
  })

  it('listSpeakerLists reads under both the owner tag and the shared-list tag', async () => {
    // The read side of fix 4: a subscription with no write able to expire it is the bug,
    // so this pins that the read actually carries both tags, not only that the writes name
    // them.
    const api = fakeSpeakersApi()
    const { reads } = await load(api.fetchImpl)

    await reads.listSpeakerLists('recUsr1')

    const read = api.readLog.find((entry) => entry.table === 'SpeakerLists')
    expect(read?.tags).toEqual(['user:recUsr1:speaker-lists', 'speaker-lists:shared'])
  })

  it("listSpeakerLists never returns another user's private list", async () => {
    // The actual bug: two review rounds fixed the doc comment and the cache tags without
    // ever filtering what the function returns. User B calling this must not get user A's
    // isShared: false list back, only their own and anything marked shared.
    const api = fakeSpeakersApi({
      initial: {
        SpeakerLists: [
          { id: 'recListMine', fields: { name: 'Mine', owner: ['recUsrB'], isShared: false } },
          { id: 'recListTheirs', fields: { name: 'Theirs', owner: ['recUsrA'], isShared: false } },
          { id: 'recListShared', fields: { name: 'Shared', owner: ['recUsrA'], isShared: true } },
        ],
      },
    })
    const { reads } = await load(api.fetchImpl)

    const lists = await reads.listSpeakerLists('recUsrB')

    expect(lists.map((l) => l.id).sort()).toEqual(['recListMine', 'recListShared'])
  })
})
