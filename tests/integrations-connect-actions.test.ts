// Who may connect this event to a remote one, and what actually gets written.
//
// These two actions are the first write path `Events.accelEventUrl` and `accelEventId` have
// ever had, and the mapping they store decides which remote event every accepted session is
// pushed into. So the assertions that matter are not "it throws": they are that a refused
// caller wrote NOTHING, and that the value which reached the mutation is the normalized slug
// rather than the string the form posted. A guard that runs after the write is decoration.
//
// The disconnect assertion is the odd-looking one and it is the point of the pair: it checks
// that BOTH columns are sent as absent. `acceleventsMappingFields` turns that into an explicit
// `null`, because an omitted key leaves the old value in place, and a disconnect that omitted
// them would report success while the event carried on pushing into the same remote event.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError, ErrorIds } from '@/constants/errorIds'

const mocks = vi.hoisted(() => ({
  requireEventRole: vi.fn(),
  setAcceleventsMapping: vi.fn(() => Promise.resolve({}) as Promise<never>),
  revalidateTag: vi.fn(),
}))

vi.mock('@/features/auth/wiring', () => ({ requireEventRole: mocks.requireEventRole }))
vi.mock('@/services/airtable/mutations-event', () => ({
  setAcceleventsMapping: mocks.setAcceleventsMapping,
}))
vi.mock('next/cache', () => ({ revalidateTag: mocks.revalidateTag }))

const { connectAcceleventsAction, disconnectAcceleventsAction } = await import(
  '@/features/integrations/actions'
)

const EVENT = 'recEvent1'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireEventRole.mockResolvedValue({ role: 'admin' })
})

describe('connectAcceleventsAction', () => {
  it('refuses a reviewer and writes nothing', async () => {
    mocks.requireEventRole.mockRejectedValue(
      new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'admin required', {}),
    )

    const result = await connectAcceleventsAction({
      eventId: EVENT,
      eventUrl: 'summit',
      remoteEventId: '',
    })

    expect(result.ok).toBe(false)
    expect(mocks.setAcceleventsMapping).not.toHaveBeenCalled()
  })

  it('asks for admin on the event it is about to map, not merely for a session', async () => {
    await connectAcceleventsAction({ eventId: EVENT, eventUrl: 'summit', remoteEventId: '' })

    expect(mocks.requireEventRole).toHaveBeenCalledWith(EVENT, 'admin')
  })

  it('refuses a blank event URL and writes nothing', async () => {
    const result = await connectAcceleventsAction({
      eventId: EVENT,
      eventUrl: '   ',
      remoteEventId: '99',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errorId).toBe(ErrorIds.SUB_VALIDATION_FAIL)
    expect(mocks.setAcceleventsMapping).not.toHaveBeenCalled()
  })

  it('stores the slug out of a pasted address, never the address itself', async () => {
    // The silent failure this prevents: `accelEventUrl` is interpolated into
    // `/rest/host/event/{eventUrl}/speakers`, so a stored URL builds a request path with a
    // whole URL inside it and 404s with nothing on screen to say why.
    const result = await connectAcceleventsAction({
      eventId: EVENT,
      eventUrl: 'https://events.accelevents.com/e/summit?utm_source=email',
      remoteEventId: ' 12345 ',
    })

    expect(result.ok).toBe(true)
    expect(mocks.setAcceleventsMapping).toHaveBeenCalledWith({
      eventId: EVENT,
      eventUrl: 'summit',
      remoteEventId: '12345',
    })
  })

  it('reports the STORED slug back, not what was typed', async () => {
    const result = await connectAcceleventsAction({
      eventId: EVENT,
      eventUrl: 'https://events.accelevents.com/e/summit',
      remoteEventId: '',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.eventUrl).toBe('summit')
  })
})

describe('disconnectAcceleventsAction', () => {
  it('refuses a reviewer and writes nothing', async () => {
    mocks.requireEventRole.mockRejectedValue(
      new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'admin required', {}),
    )

    const result = await disconnectAcceleventsAction({ eventId: EVENT })

    expect(result.ok).toBe(false)
    expect(mocks.setAcceleventsMapping).not.toHaveBeenCalled()
  })

  it('sends neither column, which is what clears both of them', async () => {
    const result = await disconnectAcceleventsAction({ eventId: EVENT })

    expect(result.ok).toBe(true)
    expect(mocks.setAcceleventsMapping).toHaveBeenCalledWith({ eventId: EVENT })
  })
})
