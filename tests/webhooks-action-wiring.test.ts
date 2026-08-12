// Do the actions an organizer actually presses reach a producer?
//
// tests/webhooks-producers.test.ts pins what each producer emits when it is called. That is
// the half that was already true of `submission.status_changed`, which had a correct producer
// and a correct payload and was reached from exactly ONE of the five paths that move a
// submission. The bug was never in the producer; it was that nothing called it. So these
// tests drive the Server Actions themselves, with the Airtable layer stubbed, and assert an
// occurrence came out the far end.
//
// Every one of these fails by SILENCE. The write lands, the screen updates, the delivery
// queue is empty, and there is no error at either end to notice: exactly the shape of the
// four gaps this file exists to keep closed.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WebhookOccurrence } from '@/features/webhooks/enqueue'

const EVENT = 'recEvent000000001'

const enqueued: WebhookOccurrence[] = []

vi.mock('@/features/webhooks/enqueue', () => ({
  enqueueWebhookEvent: (occurrence: WebhookOccurrence) => {
    enqueued.push(occurrence)
    return Promise.resolve({ endpoints: 1, queued: 1, skipped: 0 })
  },
}))

/** Authorization is covered by its own suites; here it must simply not be the thing failing. */
vi.mock('@/features/auth/wiring', () => ({
  requireEventRole: () => Promise.resolve('admin'),
  requireSpeaker: () => Promise.resolve({ speakerId: 'recSpk1' }),
}))

vi.mock('@/services/airtable/invalidate', () => ({ invalidate: () => undefined }))

const SESSION = {
  id: 'recSub1',
  eventId: EVENT,
  code: 'AIE-001',
  title: 'Agents at scale',
  status: 'accepted',
  scheduleStatus: 'scheduled',
  roomId: 'recRoom1',
  startsAt: '2026-09-01T09:00:00.000Z',
  endsAt: '2026-09-01T10:00:00.000Z',
  reviewRequired: true,
  participants: [],
}

const scheduleWrites: unknown[] = []
const statusWrites: unknown[] = []

vi.mock('@/services/airtable/mutations', () => ({
  scheduleSubmission: (change: unknown) => {
    scheduleWrites.push(change)
    return Promise.resolve()
  },
  setSubmissionStatus: (change: unknown) => {
    statusWrites.push(change)
    return Promise.resolve()
  },
  createSubmission: () => Promise.resolve({ id: 'recNew', code: 'AIE-999' }),
}))

vi.mock('@/services/airtable/queries', () => ({
  listSubmissions: () => Promise.resolve([SESSION]),
  listRooms: () => Promise.resolve([{ id: 'recRoom1', eventId: EVENT, name: 'Hall A', order: 1 }]),
  listSpeakers: () => Promise.resolve([]),
  getSubmission: () => Promise.resolve(SESSION),
  getSpeaker: (id: string) =>
    Promise.resolve({ id, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' }),
  getEvent: () => Promise.resolve({ id: EVENT, name: 'AIE', slug: 'aie' }),
  listForms: () => Promise.resolve([]),
}))

// ── The portal half: the speaker's own two paths ─────────────────────────────

const TASK = { id: 'recTask1', eventId: EVENT, title: 'Send a headshot', kind: 'confirm' }

vi.mock('@/features/portal/event-scope', () => ({
  portalEventIds: () => Promise.resolve([EVENT]),
  speakerHomeEventId: () => Promise.resolve(EVENT),
}))

vi.mock('@/features/portal/resolve-submission', () => ({
  resolveOwnSubmission: () => Promise.resolve({ ...SESSION, status: 'pending' }),
}))

vi.mock('@/features/portal/own-assignment', () => ({
  resolveOwnAssignment: () =>
    Promise.resolve({
      eventId: EVENT,
      item: { assignment: { id: 'recAsg1', status: 'pending' }, task: TASK },
    }),
}))

const completions: unknown[] = []
vi.mock('@/features/portal/ports', () => ({
  portalDataPort: () => ({
    completeTaskAssignment: (completion: unknown) => {
      completions.push(completion)
      return Promise.resolve()
    },
  }),
  // `actions.ts` installs the real port at module scope, so importing it calls this. A no-op
  // on purpose: the stub above already decides what `portalDataPort()` hands back, and letting
  // the real install run would point this suite at Airtable.
  setPortalDataPort: () => undefined,
}))

const { setSessionPublicationAction } = await import('@/features/agenda/actions')
const { setStatusAction } = await import('@/features/submissions/decisions')
const { completeTaskAction, withdrawSubmissionAction } = await import('@/features/portal/actions')

beforeEach(() => {
  enqueued.length = 0
  scheduleWrites.length = 0
  completions.length = 0
  statusWrites.length = 0
})

describe('publishing from the agenda', () => {
  it('announces the session it just put on the public agenda', async () => {
    await setSessionPublicationAction(EVENT, ['recSub1'], true)

    expect(scheduleWrites).toHaveLength(1)
    expect(enqueued.at(0)).toMatchObject({
      eventId: EVENT,
      key: 'session.published:recSub1:2026-09-01T09:00:00.000Z',
      payload: {
        type: 'session.published',
        submission: { id: 'recSub1', code: 'AIE-001', title: 'Agents at scale' },
        // The room NAME, resolved from the id the change carries.
        slot: { startsAt: '2026-09-01T09:00:00.000Z', room: 'Hall A' },
      },
    })
  })

  it('says nothing when the same session is taken back off it', async () => {
    // Unpublishing is not one of the four declared event types. It must produce no
    // occurrence rather than a `session.published` carrying a `scheduled` status.
    await setSessionPublicationAction(EVENT, ['recSub1'], false)
    expect(enqueued).toEqual([])
  })
})

describe('the inline status chip', () => {
  it('announces a transition an organizer made without going through the queues', async () => {
    // This path wrote a real decision and told nobody. It is not the bulk action, it is not
    // Notify, and it was the one an organizer reaches for on a single row.
    await setStatusAction({ eventId: EVENT, submissionId: 'recSub1', status: 'withdrawn' })

    expect(statusWrites).toHaveLength(1)
    expect(enqueued.at(0)).toMatchObject({
      key: 'submission.status_changed:recSub1:withdrawn',
      payload: {
        type: 'submission.status_changed',
        newStatus: 'withdrawn',
        previousStatus: 'accepted',
      },
    })
  })

  it('announces nothing when the chip is set to the status it already holds', async () => {
    await setStatusAction({ eventId: EVENT, submissionId: 'recSub1', status: 'accepted' })

    expect(statusWrites).toEqual([])
    expect(enqueued).toEqual([])
  })
})

describe('what the speaker does in their own portal', () => {
  it('announces a withdrawal, which is the one an organizer most needs to hear', async () => {
    const form = new FormData()
    form.set('code', 'AIE-001')

    expect(await withdrawSubmissionAction(form)).toMatchObject({ ok: true })
    expect(enqueued.at(0)).toMatchObject({
      key: 'submission.status_changed:recSub1:withdrawn',
      payload: { newStatus: 'withdrawn', previousStatus: 'pending' },
    })
  })

  it('announces a completed task, named, so the channel reads as a person did something', async () => {
    const form = new FormData()
    form.set('assignmentId', 'recAsg1')
    form.set('confirmed', 'on')

    expect(await completeTaskAction(form)).toMatchObject({ ok: true })
    expect(completions).toHaveLength(1)
    expect(enqueued.at(0)).toMatchObject({
      eventId: EVENT,
      key: 'task.completed:recAsg1',
      payload: {
        type: 'task.completed',
        task: { id: 'recTask1', title: 'Send a headshot' },
        speaker: { id: 'recSpk1', name: 'Ada Lovelace' },
      },
    })
  })
})
