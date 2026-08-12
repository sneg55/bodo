// The CRM write layer: chunking, tag invalidation, and the outbox comms tag. Saved lists
// have their own file, tests/crm-mutations-lists.test.ts, and the speaker CSV import
// (`upsertSpeakersBatch`) has its own, tests/crm-mutations-import.test.ts - all three were
// over the line limit together.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { chunkForAirtable } from '@/services/airtable/mutations-crm'
import { fakeSpeakersApi } from './helpers/fake-speakers-api'

const revalidateTag = vi.hoisted(() => vi.fn())

vi.mock('next/cache', () => ({ revalidateTag }))

const ORIGINAL_ENV = { ...process.env }

/** Load the mutation modules with credentials configured and `fetch` stubbed. */
async function load(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  process.env = { ...ORIGINAL_ENV, AIRTABLE_TOKEN: 'patTest', AIRTABLE_BASE_ID: 'appTest' }
  vi.resetModules()
  vi.stubGlobal('fetch', fetchImpl)
  return {
    crm: await import('@/services/airtable/mutations-crm'),
    outbox: await import('@/services/airtable/mutations-outbox'),
  }
}

beforeEach(() => {
  revalidateTag.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL_ENV }
})

describe('chunkForAirtable', () => {
  it('batches at ten, which is the Airtable write limit', () => {
    const sizes = chunkForAirtable(Array.from({ length: 25 }, (_, i) => i)).map((c) => c.length)
    expect(sizes).toEqual([10, 10, 5])
  })

  it('returns nothing for an empty input', () => {
    expect(chunkForAirtable([])).toEqual([])
  })

  it('does not pad the last batch', () => {
    expect(chunkForAirtable([1, 2, 3]).at(-1)).toEqual([1, 2, 3])
  })
})

describe('createSpeakerTag', () => {
  it('creates the row and expires only the tag vocabulary', async () => {
    const { crm } = await load(fakeSpeakersApi().fetchImpl)

    const tag = await crm.createSpeakerTag('action', { name: 'Keynote', color: '#ff0000' })

    expect(tag).toMatchObject({ name: 'Keynote', color: '#ff0000' })
    expect(revalidateTag.mock.calls.map((call): unknown => call[0])).toEqual(['speaker-tags'])
  })
})

describe('setSpeakerTags', () => {
  it('adds the speaker to a newly selected tag and drops it from a deselected one', async () => {
    const api = fakeSpeakersApi({
      initial: {
        SpeakerTags: [
          { id: 'recTag1', fields: { name: 'Keynote', speakers: ['recSpk1'] } },
          { id: 'recTag2', fields: { name: 'Panel', speakers: [] } },
        ],
      },
    })
    const { crm } = await load(api.fetchImpl)

    await crm.setSpeakerTags('action', 'recSpk1', ['recTag2'])

    expect(api.rows('SpeakerTags').find((r) => r.id === 'recTag1')?.fields.speakers).toEqual([])
    expect(api.rows('SpeakerTags').find((r) => r.id === 'recTag2')?.fields.speakers).toEqual([
      'recSpk1',
    ])
  })

  it('writes nothing and still expires when membership is already correct', async () => {
    const api = fakeSpeakersApi({
      initial: { SpeakerTags: [{ id: 'recTag1', fields: { speakers: ['recSpk1'] } }] },
    })
    const { crm } = await load(api.fetchImpl)

    await crm.setSpeakerTags('action', 'recSpk1', ['recTag1'])

    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toEqual(['speaker-tags', 'speaker:recSpk1'])
  })

  it('still expires its tags, and still throws, when a later patch batch rejects', async () => {
    // `client.updateRecords` chunks at 10 internally, so more than ten changed tags is
    // more than one HTTP request. Without the try/finally the first ten rows land in
    // Airtable but the function throws before reaching invalidate, and every cached read
    // of the tag vocabulary keeps serving the membership from before any of it happened.
    const fifteenTags = Array.from({ length: 15 }, (_, i) => ({
      id: `recTag${i + 1}`,
      fields: { name: `Tag${i + 1}`, speakers: [] },
    }))
    const api = fakeSpeakersApi({
      initial: { SpeakerTags: fifteenTags },
      failAfter: { table: 'SpeakerTags', afterWrites: 1, status: 401 },
    })
    const { crm } = await load(api.fetchImpl)

    await expect(
      crm.setSpeakerTags(
        'action',
        'recSpk1',
        fifteenTags.map((t) => t.id),
      ),
    ).rejects.toThrow()

    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toEqual(['speaker-tags', 'speaker:recSpk1'])
  })
})

describe('outbox writes and the CRM comms tag', () => {
  it('markOutboxSent expires speakerCommsTag when the row addressed a speaker', async () => {
    const api = fakeSpeakersApi({
      initial: { EmailOutbox: [{ id: 'recRow1', fields: { status: 'sending' } }] },
    })
    const { outbox } = await load(api.fetchImpl)

    await outbox.markOutboxSent(
      { rowId: 'recRow1', eventId: 'recEvt1', attempts: 1, sentAt: 'T1', speakerId: 'recSpk1' },
      'route',
    )

    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toContain('speaker:recSpk1:comms')
  })

  it('markOutboxSent does not expire a comms tag when the row addressed no speaker', async () => {
    const api = fakeSpeakersApi({
      initial: { EmailOutbox: [{ id: 'recRow1', fields: { status: 'sending' } }] },
    })
    const { outbox } = await load(api.fetchImpl)

    await outbox.markOutboxSent(
      { rowId: 'recRow1', eventId: 'recEvt1', attempts: 1, sentAt: 'T1' },
      'route',
    )

    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toEqual(['event:recEvt1:outbox'])
  })

  it('enqueueEmails expires speakerCommsTag for every distinct speaker queued', async () => {
    // listOutboxForSpeaker (reads-crm.ts) returns a row in ANY status, including `queued`,
    // so the CRM timeline goes stale the moment a send is queued unless enqueue names this
    // tag too, not only eventOutboxTag.
    const api = fakeSpeakersApi({ initial: { EmailOutbox: [] } })
    const { outbox } = await load(api.fetchImpl)
    const draft = (speakerId: string, key: string) => ({
      eventId: 'recEvt1',
      templateSource: 'template' as const,
      speakerId,
      idempotencyKey: key,
      payload: { subject: 'Hi', html: '<p>hi</p>', attachIcs: false },
      toEmail: `${key}@example.com`,
      sendAt: 'T1',
    })

    await outbox.enqueueEmails([draft('recSpk1', 'key-1'), draft('recSpk2', 'key-2')], 'route')

    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toContain('speaker:recSpk1:comms')
    expect(tags).toContain('speaker:recSpk2:comms')
  })

  it('markOutboxFailed expires speakerCommsTag when the row addressed a speaker', async () => {
    // Without this the timeline keeps showing `sending` forever after a permanent failure,
    // since only the successful-send path used to name this tag.
    const api = fakeSpeakersApi({
      initial: { EmailOutbox: [{ id: 'recRow1', fields: { status: 'sending' } }] },
    })
    const { outbox } = await load(api.fetchImpl)

    await outbox.markOutboxFailed(
      {
        rowId: 'recRow1',
        eventId: 'recEvt1',
        attempts: 1,
        lastError: 'boom',
        status: 'dead',
        speakerId: 'recSpk1',
      },
      'route',
    )

    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toContain('speaker:recSpk1:comms')
  })

  it('claimOutboxRow expires speakerCommsTag on the queued-to-sending transition', async () => {
    // Without this the timeline shows `queued` while the send is genuinely in flight, since
    // only the terminal writes (sent, failed, dead) used to name this tag.
    const api = fakeSpeakersApi({
      initial: { EmailOutbox: [{ id: 'recRow1', fields: { status: 'queued' } }] },
    })
    const { outbox } = await load(api.fetchImpl)

    await outbox.claimOutboxRow(
      {
        rowId: 'recRow1',
        eventId: 'recEvt1',
        leaseHolder: 'run-1',
        leaseExpiresAt: 'T2',
        attempts: 1,
        speakerId: 'recSpk1',
      },
      'route',
    )

    const tags = revalidateTag.mock.calls.map((call): unknown => call[0])
    expect(tags).toContain('speaker:recSpk1:comms')
  })
})
