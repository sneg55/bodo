// Checkpoint 3: the writes that can land in Airtable and still have to invalidate
// everything they touched (or may have touched) rather than nothing. Split out of
// crm-mutations.test.ts and crm-mutations-import.test.ts, both already near the line limit,
// because these span mutations.ts and mutations-outbox.ts rather than the CRM module either
// of those files focuses on.
//
// Two ways a write lands and the code after it does not run, and both are here:
//   - a chunked write whose LATER request rejects (`enqueueEmails`), and
//   - a single-record write answered 200 with an empty `records` array, which is what
//     `onlyRecord` throws on. The row exists; the response cannot name it. Every one of
//     these asserts the same two properties together, because a fix that keeps only one is
//     the wrong fix: the tags ARE expired, and the error still reaches the caller.

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
    speakers: await import('@/services/airtable/mutations-speakers'),
    outbox: await import('@/services/airtable/mutations-outbox'),
    crm: await import('@/services/airtable/mutations-crm'),
  }
}

beforeEach(() => {
  revalidateTag.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL_ENV }
})

describe('saveSpeakerProfile', () => {
  it('expires every event the speaker belongs to, not only the one the edit came through', async () => {
    // Same defect already fixed on upsertSpeakerByEmail's update path, on the other write
    // that touches the Speakers table: a speaker presenting at events A and B, editing
    // their profile through A, must not leave B's CRM directory and submissions stale.
    const api = fakeSpeakersApi({
      initial: {
        Speakers: [
          { id: 'recSpk1', fields: { email: 'ada@example.com', events: ['recEvtA', 'recEvtB'] } },
        ],
      },
    })
    const { speakers } = await load(api.fetchImpl)

    await speakers.saveSpeakerProfile({
      speakerId: 'recSpk1',
      eventId: 'recEvtA',
      draft: { email: 'ada@example.com', firstName: 'Ada', company: 'New Co' },
    })

    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toContain('event:recEvtA:speakers')
    expect(tags).toContain('event:recEvtB:speakers')
    expect(tags).toContain('event:recEvtA:submissions')
    expect(tags).toContain('event:recEvtB:submissions')
    expect(tags).toContain('speaker:recSpk1')
  })

  it('still names the edit event even if the stored events link is somehow missing it', async () => {
    const api = fakeSpeakersApi({
      initial: { Speakers: [{ id: 'recSpk1', fields: { email: 'ada@example.com', events: [] } }] },
    })
    const { speakers } = await load(api.fetchImpl)

    await speakers.saveSpeakerProfile({
      speakerId: 'recSpk1',
      eventId: 'recEvtA',
      draft: { email: 'ada@example.com' },
    })

    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toContain('event:recEvtA:speakers')
  })

  it('expires the edit event AND surfaces the failure when the write answers 200 with zero records', async () => {
    // Two properties, and an earlier version of this fix only kept one at a time. Version
    // one let onlyRecord's throw skip invalidate entirely - the exact "successful
    // response, wrong record count, so treat it as nothing written" claim this whole file
    // exists to reject. Version two caught that throw and fixed the invalidation, but
    // swallowed the error, so a caller (saveProfileAction) went on to tell the speaker
    // "Your changes have been saved" for a write it could not confirm landed - worse than
    // the stale-cache bug this thread started from, because a stale cache self-corrects in
    // 60 seconds and a false confirmation does not. try/finally is what keeps both: the
    // floor tag is expired in finally regardless, and the throw still reaches the caller.
    const api = fakeSpeakersApi({
      initial: { Speakers: [{ id: 'recSpk1', fields: { email: 'ada@example.com', events: [] } }] },
      emptyPatchResponseFor: 'Speakers',
    })
    const { speakers } = await load(api.fetchImpl)

    await expect(
      speakers.saveSpeakerProfile({
        speakerId: 'recSpk1',
        eventId: 'recEvtA',
        draft: { email: 'ada@example.com' },
      }),
    ).rejects.toThrow()

    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toEqual(['speaker:recSpk1', 'event:recEvtA:speakers', 'event:recEvtA:submissions'])
  })
})

describe('upsertSpeakerByEmail', () => {
  it('expires the event speaker lists on a create, so a new co-presenter appears at once', async () => {
    const api = fakeSpeakersApi({ initial: { Speakers: [] } })
    const { speakers } = await load(api.fetchImpl)

    const speaker = await speakers.upsertSpeakerByEmail({
      email: 'ada@example.com',
      firstName: 'Ada',
      eventIds: ['recEvtA'],
    })

    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toEqual([`speaker:${speaker.id}`, 'event:recEvtA:speakers'])
  })

  it('expires the drafted events AND surfaces the failure when the create answers 200 with zero records', async () => {
    // The CFP submit path: a co-presenter is created, Airtable answers 200 with a short
    // records array, and `onlyRecord` throws. The speaker record exists either way, so
    // leaving `event:{id}:speakers` unexpired serves the admin speaker list and the CRM
    // directory a roster without the new co-presenter for the whole REVALIDATE.edited
    // window. `speaker:{id}` is the one tag that legitimately drops out here - there is no
    // id to name - and the event tags come from the draft, which is known before the write.
    const api = fakeSpeakersApi({
      initial: { Speakers: [] },
      emptyCreateResponseFor: 'Speakers',
    })
    const { speakers } = await load(api.fetchImpl)

    await expect(
      speakers.upsertSpeakerByEmail({ email: 'ada@example.com', eventIds: ['recEvtA', 'recEvtB'] }),
    ).rejects.toThrow()

    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toEqual(['event:recEvtA:speakers', 'event:recEvtB:speakers'])
  })

  it('expires every merged event AND surfaces the failure when the update answers 200 with zero records', async () => {
    // The update path loses no precision at all to the unreadable response: the row's id is
    // the one that was looked up, and the merged event ids were computed before the write.
    const api = fakeSpeakersApi({
      initial: {
        Speakers: [
          { id: 'recSpk1', fields: { email: 'ada@example.com', events: ['recEvtA', 'recEvtB'] } },
        ],
      },
      emptyPatchResponseFor: 'Speakers',
    })
    const { speakers } = await load(api.fetchImpl)

    await expect(
      speakers.upsertSpeakerByEmail({ email: 'ada@example.com', eventIds: ['recEvtC'] }),
    ).rejects.toThrow()

    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toEqual([
      'speaker:recSpk1',
      'event:recEvtA:speakers',
      'event:recEvtB:speakers',
      'event:recEvtC:speakers',
    ])
  })
})

describe('createSpeakerTag', () => {
  it('expires the tag vocabulary AND surfaces the failure when the create answers 200 with zero records', async () => {
    // The tag row exists, so every picker reading the vocabulary is stale until something
    // expires it - and the caller must still not be told the tag was saved.
    const api = fakeSpeakersApi({ emptyCreateResponseFor: 'SpeakerTags' })
    const { crm } = await load(api.fetchImpl)

    await expect(
      crm.createSpeakerTag('action', { name: 'Keynote', color: 'blue' }),
    ).rejects.toThrow()

    expect(revalidateTag.mock.calls.map((call): unknown => call[0])).toEqual(['speaker-tags'])
  })
})

describe('saveSpeakerList', () => {
  it('expires both list tags AND surfaces the failure when the create answers 200 with zero records', async () => {
    const api = fakeSpeakersApi({ emptyCreateResponseFor: 'SpeakerLists' })
    const { crm } = await load(api.fetchImpl)

    await expect(
      crm.saveSpeakerList('action', {
        name: 'Keynotes',
        ownerId: 'recUsr1',
        isShared: true,
        filters: [],
      }),
    ).rejects.toThrow()

    expect(revalidateTag.mock.calls.map((call): unknown => call[0])).toEqual([
      'user:recUsr1:speaker-lists',
      'speaker-lists:shared',
    ])
  })

  it('expires both list tags AND surfaces the failure when the update answers 200 with zero records', async () => {
    const api = fakeSpeakersApi({
      initial: { SpeakerLists: [{ id: 'recList1', fields: { name: 'Old' } }] },
      emptyPatchResponseFor: 'SpeakerLists',
    })
    const { crm } = await load(api.fetchImpl)

    await expect(
      crm.saveSpeakerList('action', {
        id: 'recList1',
        name: 'Keynotes',
        ownerId: 'recUsr1',
        isShared: false,
        filters: [],
      }),
    ).rejects.toThrow()

    expect(revalidateTag.mock.calls.map((call): unknown => call[0])).toEqual([
      'user:recUsr1:speaker-lists',
      'speaker-lists:shared',
    ])
  })
})

describe('enqueueEmails partial failure', () => {
  it('expires every touched tag even when a later upsert batch rejects', async () => {
    // client.ts writes a chunked upsert's requests sequentially: with 15 rows that is two
    // requests (10 then 5). If the second one throws, the first ten rows already landed in
    // Airtable, and without the try/finally in enqueueEmails those ten speakers' cached
    // timelines and the event's cached outbox would never learn the queue changed.
    const api = fakeSpeakersApi({
      initial: { EmailOutbox: [] },
      failAfter: { table: 'EmailOutbox', afterWrites: 1, status: 401 },
    })
    const { outbox } = await load(api.fetchImpl)

    const rows = Array.from({ length: 15 }, (_, i) => ({
      eventId: 'recEvt1',
      templateSource: 'template' as const,
      speakerId: `recSpk${i + 1}`,
      idempotencyKey: `key-${i + 1}`,
      payload: { subject: 'Hi', html: '<p>hi</p>', attachIcs: false },
      toEmail: `s${i + 1}@example.com`,
      sendAt: 'T1',
    }))

    await expect(outbox.enqueueEmails(rows, 'route')).rejects.toThrow()

    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toContain('event:recEvt1:outbox')
    expect(tags).toContain('speaker:recSpk1:comms')
    expect(tags).toContain('speaker:recSpk15:comms')
  })
})
