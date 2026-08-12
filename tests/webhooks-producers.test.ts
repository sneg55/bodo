// The producers: the places that decide a webhook occurrence exists at all.
//
// `dispatch.ts` and `enqueue.ts` are covered elsewhere on their own terms, and they are the
// half that runs only if somebody calls it. This file is about the half that CALLS, and every
// assertion here is a bug that shipped: `submission.status_changed` had one producer out of
// five status-writing paths, and `task.completed` and `session.published` were declared,
// documented, subscribable in the settings UI and covered by payload tests while nothing in
// the product ever emitted either one. A subscriber ticked those boxes and heard silence.
//
// What is pinned:
//   - The idempotency key, per type, because that is what makes a double press one delivery
//     and what makes two different occurrences two. A key that collides drops an event with
//     no error anywhere.
//   - The transition a subscriber renders: the status LEFT rides in the payload, so a
//     producer reading it after its own write would report "Accepted → Accepted".
//   - The swallow. A webhook may never fail the mutation it is reporting, so a broken enqueue
//     or an unreadable speaker has to cost the payload a field, not the organizer their action.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WebhookOccurrence } from '@/features/webhooks/enqueue'

const enqueued: WebhookOccurrence[] = []
const record = (occurrence: WebhookOccurrence): Promise<unknown> => {
  enqueued.push(occurrence)
  return Promise.resolve({ endpoints: 1, queued: 1, skipped: 0 })
}

let enqueueImpl: (occurrence: WebhookOccurrence) => Promise<unknown> = record

vi.mock('@/features/webhooks/enqueue', () => ({
  enqueueWebhookEvent: (occurrence: WebhookOccurrence) => enqueueImpl(occurrence),
}))

const statusWrites: unknown[] = []
vi.mock('@/services/airtable/mutations', () => ({
  setSubmissionStatus: (change: unknown) => {
    statusWrites.push(change)
    return Promise.resolve()
  },
}))

let speakerImpl: (id: string) => Promise<unknown> = (id) =>
  Promise.resolve({ id, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' })

vi.mock('@/services/airtable/queries', () => ({
  getSpeaker: (id: string) => speakerImpl(id),
  listRooms: (eventId: string) =>
    Promise.resolve([{ id: 'recRoom1', eventId, name: 'Hall A', order: 1 }]),
}))

const {
  announceSessionPublished,
  announceStatusChange,
  announceSubmissionCreated,
  announceTaskCompleted,
} = await import('@/features/webhooks/announce')
const { commitStatus } = await import('@/features/submissions/commit-status')
const { announcePublications, publishedSessions } = await import(
  '@/features/agenda/announce-published'
)

const EVENT = 'recEvent000000001'
const SUBMISSION = { id: 'recSub1', code: 'AIE-001', title: 'Agents at scale' }

beforeEach(() => {
  enqueued.length = 0
  statusWrites.length = 0
  enqueueImpl = record
  speakerImpl = (id) =>
    Promise.resolve({ id, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' })
})

describe('the idempotency key each producer derives', () => {
  it('keys a status change on the status moved TO, so two routes there are one delivery', async () => {
    await announceStatusChange(EVENT, SUBMISSION, 'accepted', 'pending')
    await announceStatusChange(EVENT, SUBMISSION, 'accepted', 'accept_queue')

    expect(enqueued.map((occurrence) => occurrence.key)).toEqual([
      'submission.status_changed:recSub1:accepted',
      'submission.status_changed:recSub1:accepted',
    ])
    // The transition still rides in the payload even though it does not decide identity.
    expect(enqueued.at(0)?.payload).toMatchObject({
      newStatus: 'accepted',
      previousStatus: 'pending',
    })
  })

  it('keys a creation on the submission alone, which is created exactly once', async () => {
    await announceSubmissionCreated(EVENT, SUBMISSION)
    expect(enqueued.at(0)?.key).toBe('submission.created:recSub1')
  })

  it('keys a completed task on the ASSIGNMENT, not the task everyone shares', async () => {
    // One task is assigned to every speaker on the event. Keying on the task would let the
    // first person to finish swallow every other completion, since the enqueue upserts.
    await announceTaskCompleted(EVENT, 'recAsg1', { id: 'recTask1', title: 'Send a headshot' })
    await announceTaskCompleted(EVENT, 'recAsg2', { id: 'recTask1', title: 'Send a headshot' })

    expect(enqueued.map((occurrence) => occurrence.key)).toEqual([
      'task.completed:recAsg1',
      'task.completed:recAsg2',
    ])
  })

  it('keys a publication on the slot, so republishing after a move says so again', async () => {
    await announceSessionPublished(EVENT, SUBMISSION, { startsAt: '2026-09-01T09:00:00.000Z' })
    await announceSessionPublished(EVENT, SUBMISSION, { startsAt: '2026-09-01T14:00:00.000Z' })

    expect(enqueued.map((occurrence) => occurrence.key)).toEqual([
      'session.published:recSub1:2026-09-01T09:00:00.000Z',
      'session.published:recSub1:2026-09-01T14:00:00.000Z',
    ])
  })
})

describe('announceTaskCompleted names the speaker', () => {
  it('resolves the name so a channel reads "by Ada Lovelace" rather than a bare task', async () => {
    await announceTaskCompleted(EVENT, 'recAsg1', { id: 'recTask1', title: 'Headshot' }, 'recSpk1')

    expect(enqueued.at(0)?.payload).toEqual({
      type: 'task.completed',
      task: { id: 'recTask1', title: 'Headshot' },
      speaker: { id: 'recSpk1', name: 'Ada Lovelace' },
    })
  })

  it('omits the speaker rather than posting their email to an arbitrary URL', async () => {
    // `displayNameOf` falls back to the email, which is right for a screen the organizer is
    // already looking at and wrong for an outbound POST to whatever a settings box holds.
    speakerImpl = (id) =>
      Promise.resolve({ id, firstName: ' ', lastName: '', email: 'ada@example.com' })

    await announceTaskCompleted(EVENT, 'recAsg1', { id: 'recTask1', title: 'Headshot' }, 'recSpk1')

    expect(enqueued.at(0)?.payload).not.toHaveProperty('speaker')
  })

  it('still announces when the speaker cannot be read, because the name is decoration', async () => {
    speakerImpl = () => Promise.reject(new Error('airtable is down'))

    await expect(
      announceTaskCompleted(EVENT, 'recAsg1', { id: 'recTask1', title: 'Headshot' }, 'recSpk1'),
    ).resolves.toBeUndefined()
    expect(enqueued).toHaveLength(1)
  })
})

describe('commitStatus fuses the write to the announcement', () => {
  const row = {
    id: 'recSub1',
    code: 'AIE-001',
    title: 'Agents at scale',
    status: 'pending',
    // No `formId`: the track reconciliation `commitStatus` now runs on accept
    // (`commit-status.ts`) short-circuits on a manual row before it would need to reach
    // `listForms`, which is not mocked in this file. `answers`/`tagIds` are required on
    // `Submission` regardless of that, so they are here to satisfy the type.
    answers: {},
    tagIds: [],
  } as const

  it('writes first, then reports the status it LEFT', async () => {
    await commitStatus(EVENT, row, 'accepted', '2026-08-11T10:00:00.000Z')

    expect(statusWrites).toEqual([
      {
        submissionId: 'recSub1',
        eventId: EVENT,
        status: 'accepted',
        notifiedAt: '2026-08-11T10:00:00.000Z',
      },
    ])
    // `previousStatus` comes off the row as it was read, before the write. A producer that
    // re-read the record here would report "Accepted → Accepted" on every decision.
    expect(enqueued.at(0)?.payload).toMatchObject({
      type: 'submission.status_changed',
      newStatus: 'accepted',
      previousStatus: 'pending',
    })
  })

  it('does not let a failing enqueue undo a decision that is already written', async () => {
    enqueueImpl = () => Promise.reject(new Error('no such table'))

    await expect(commitStatus(EVENT, row, 'withdrawn')).resolves.toBeUndefined()
    expect(statusWrites).toHaveLength(1)
  })
})

describe('publishedSessions', () => {
  const session = (id: string, code: string) => ({
    id,
    code,
    title: `Talk ${code}`,
    eventId: EVENT,
  })
  const change = (id: string, scheduleStatus: 'published' | 'scheduled', startsAt?: string) => ({
    eventId: EVENT,
    submissionId: id,
    roomId: 'recRoom1',
    startsAt,
    endsAt: '2026-09-01T10:00:00.000Z',
    scheduleStatus,
  })

  const rows = [session('recSub1', 'AIE-001'), session('recSub2', 'AIE-002')] as never

  it('announces the sessions going public and stays silent on the ones coming down', () => {
    const selected = publishedSessions(
      [
        change('recSub1', 'published', '2026-09-01T09:00:00.000Z'),
        change('recSub2', 'scheduled', '2026-09-01T09:00:00.000Z'),
      ],
      rows,
    )

    // Unpublishing is not an event type, so an Unpublish batch must produce nothing at all
    // rather than a `session.published` with a scheduled status buried in it.
    expect(selected.map((entry) => entry.submission.code)).toEqual(['AIE-001'])
  })

  it('drops a change whose session is not in the list rather than sending a blank title', () => {
    expect(
      publishedSessions([change('recGone', 'published', '2026-09-01T09:00:00.000Z')], rows),
    ).toEqual([])
  })

  it('drops a published change with no start time, which the payload requires', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(publishedSessions([change('recSub1', 'published', undefined)], rows)).toEqual([])
    // Warned rather than dropped silently: it means a row is published with no slot.
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('announcePublications', () => {
  const rows = [
    { id: 'recSub1', code: 'AIE-001', title: 'Agents at scale', eventId: EVENT },
  ] as never

  it('resolves the room NAME, because a room id in a Discord message means nothing', async () => {
    await announcePublications(
      EVENT,
      [
        {
          eventId: EVENT,
          submissionId: 'recSub1',
          roomId: 'recRoom1',
          startsAt: '2026-09-01T09:00:00.000Z',
          endsAt: '2026-09-01T10:00:00.000Z',
          scheduleStatus: 'published',
        },
      ],
      rows,
    )

    expect(enqueued.at(0)?.payload).toMatchObject({
      type: 'session.published',
      slot: {
        startsAt: '2026-09-01T09:00:00.000Z',
        endsAt: '2026-09-01T10:00:00.000Z',
        room: 'Hall A',
      },
    })
  })

  it('reads no rooms at all when the batch publishes nothing', async () => {
    await announcePublications(
      EVENT,
      [
        {
          eventId: EVENT,
          submissionId: 'recSub1',
          startsAt: '2026-09-01T09:00:00.000Z',
          scheduleStatus: 'scheduled',
        },
      ],
      rows,
    )

    expect(enqueued).toEqual([])
  })
})
