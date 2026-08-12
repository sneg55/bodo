// The CRM's whole-scope reads: the ones answering a question about EVERY speaker the
// viewer can see, from a single pass over a table.
//
// They exist because the alternative is a read per row or a read per event, which is the
// fan-out `scheduler.ts` exists to prevent, and both were written that way first. So the
// request COUNT is pinned here as firmly as the answers, along with the cache contract:
// a read of SpeakerTags under the wrong tag can never be expired by the writes that change
// it (`speakerTag(speakerId)` is bound to the SPEAKERS table, not that one), and one under
// the wrong window serves hour-old membership from a screen whose whole job is tagging
// people. All of it is invisible in a browser until somebody complains.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ListOptions } from '@/services/airtable/client'

const mocks = vi.hoisted(() => ({ listAll: vi.fn() }))

vi.mock('@/services/airtable/client', () => ({ getClient: () => ({ listAll: mocks.listAll }) }))

const { REVALIDATE } = await import('@/services/airtable/read-cache')
const { listSpeakersForEvents, listSpeakersInEvents, listSpeakerTagIds, listSpeakerTagMembership } =
  await import('@/services/airtable/reads-crm')

/** A SpeakerTags row as the client hands it back: id plus raw fields. */
const tagRow = (id: string, name: string, speakerIds: readonly string[]) => ({
  id,
  fields: { name, color: '#64748b', speakers: speakerIds },
})

const ROWS = [
  tagRow('tag1', 'Keynote', ['spk1', 'spk2']),
  tagRow('tag2', 'Alumni', ['spk1']),
  tagRow('tag3', 'Unused', []),
]

beforeEach(() => {
  mocks.listAll.mockReset()
  mocks.listAll.mockResolvedValue(ROWS)
})

describe('listSpeakerTagMembership', () => {
  it('reads the table once, however many speakers carry tags', () => {
    return listSpeakerTagMembership().then(() => {
      expect(mocks.listAll).toHaveBeenCalledTimes(1)
    })
  })

  it('subscribes to the tag both SpeakerTags writes expire', async () => {
    await listSpeakerTagMembership()
    const [table, options] = mocks.listAll.mock.calls[0] as [string, ListOptions]
    expect(table).toBe('SpeakerTags')
    // `speaker-tags` is what createSpeakerTag and setSpeakerTags both name. A per-speaker
    // tag would look tidier and would never be expired by either of them.
    expect(options.tags).toEqual(['speaker-tags'])
  })

  it('caches for the edited window, not the lookup one', async () => {
    // Membership is a routine CRM edit. The VOCABULARY is what changes a few times a year,
    // and that is the read that keeps `lookup`.
    await listSpeakerTagMembership()
    const [, options] = mocks.listAll.mock.calls[0] as [string, ListOptions]
    expect(options.revalidate).toBe(REVALIDATE.edited)
  })

  it('inverts the link into one entry per speaker', async () => {
    const membership = await listSpeakerTagMembership()
    expect([...membership]).toEqual([
      ['spk1', ['tag1', 'tag2']],
      ['spk2', ['tag1']],
    ])
  })

  it('leaves out a speaker who carries no tag at all', async () => {
    expect((await listSpeakerTagMembership()).has('spk9')).toBe(false)
  })

  it('counts a tag once even if its link names the same speaker twice', async () => {
    mocks.listAll.mockResolvedValue([tagRow('tag1', 'Keynote', ['spk1', 'spk1'])])
    expect((await listSpeakerTagMembership()).get('spk1')).toEqual(['tag1'])
  })

  it('returns an empty map for an empty table rather than throwing', async () => {
    mocks.listAll.mockResolvedValue([])
    expect([...(await listSpeakerTagMembership())]).toEqual([])
  })
})

describe('listSpeakerTagIds', () => {
  it('answers for one speaker off the same single read', async () => {
    expect(await listSpeakerTagIds('spk1')).toEqual(['tag1', 'tag2'])
    expect(mocks.listAll).toHaveBeenCalledTimes(1)
  })

  it('answers empty for a speaker with no tags', async () => {
    expect(await listSpeakerTagIds('spk9')).toEqual([])
  })
})

/** A Speakers row: the `events` link is what scopes a speaker to a viewer's events. */
const speakerRow = (id: string, last: string, eventIds: readonly string[]) => ({
  id,
  fields: { email: `${id}@example.com`, firstName: 'Ada', lastName: last, events: eventIds },
})

describe('listSpeakersInEvents', () => {
  it('reads the Speakers table once for the whole scope', async () => {
    // The point of the read. The directory used to follow it with one
    // `listSpeakers(eventId)` per event, which is this same whole-table scan again, under
    // a different cache key so nothing dedupes it.
    mocks.listAll.mockResolvedValue([speakerRow('spk1', 'Lovelace', ['e1', 'e2'])])
    await listSpeakersInEvents(['e1', 'e2', 'e3'])
    expect(mocks.listAll).toHaveBeenCalledTimes(1)
  })

  it('subscribes to one speakers tag per event in scope', async () => {
    mocks.listAll.mockResolvedValue([])
    await listSpeakersInEvents(['e1', 'e2'])
    const [table, options] = mocks.listAll.mock.calls[0] as [string, ListOptions]
    expect(table).toBe('Speakers')
    expect(options.tags).toEqual(['event:e1:speakers', 'event:e2:speakers'])
    expect(options.revalidate).toBe(REVALIDATE.edited)
  })

  it('keeps only the events the caller asked about', async () => {
    // A speaker's other conferences are events this viewer holds no membership on. The
    // Events column says "how many of YOURS", so the intersection happens here, once.
    mocks.listAll.mockResolvedValue([speakerRow('spk1', 'Lovelace', ['e1', 'e9'])])
    expect((await listSpeakersInEvents(['e1', 'e2']))[0].eventIds).toEqual(['e1'])
  })

  it('leaves out a speaker on none of them', async () => {
    mocks.listAll.mockResolvedValue([speakerRow('spk9', 'Elsewhere', ['e9'])])
    expect(await listSpeakersInEvents(['e1'])).toEqual([])
  })

  it('counts a repeated link once', async () => {
    mocks.listAll.mockResolvedValue([speakerRow('spk1', 'Lovelace', ['e1', 'e1'])])
    expect((await listSpeakersInEvents(['e1']))[0].eventIds).toEqual(['e1'])
  })

  it('sorts by family name, like the roster read it backs', async () => {
    mocks.listAll.mockResolvedValue([
      speakerRow('spk1', 'Lovelace', ['e1']),
      speakerRow('spk2', 'Hopper', ['e1']),
    ])
    const roster = await listSpeakersInEvents(['e1'])
    expect(roster.map((entry) => entry.speaker.lastName)).toEqual(['Hopper', 'Lovelace'])
  })

  it('reads nothing at all for an empty scope', async () => {
    expect(await listSpeakersInEvents([])).toEqual([])
    expect(mocks.listAll).not.toHaveBeenCalled()
  })
})

describe('listSpeakersForEvents', () => {
  it('is the same read with the links dropped, so both sides cannot drift', async () => {
    mocks.listAll.mockResolvedValue([speakerRow('spk1', 'Lovelace', ['e1'])])
    const [speakers, entries] = [
      await listSpeakersForEvents(['e1']),
      await listSpeakersInEvents(['e1']),
    ]
    expect(speakers).toEqual(entries.map((entry) => entry.speaker))
  })
})
