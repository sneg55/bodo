// What the public API and the MCP server authorize before they answer. Four rules, each of
// which shipped broken because it lived in the gap between two files that assumed the other
// checked:
//
//   1. SCOPES are enforced. `hasScope` existed and nothing called it, so a row whose `scopes`
//      cell was blank (or held only strings the mapper drops) authenticated with full access.
//   2. The ROLE held per event survives authentication. Flattening memberships to a list of ids
//      made `reviewer` on event B indistinguishable from `admin` on A, and `outstanding_tasks`
//      hands back speaker email addresses.
//   3. A refusal is worded exactly like an unknown event, or it is a way to probe.
//   4. Tokens belong to a PERSON, not an event, so the settings page's event-level check says
//      nothing about whose rows it lists or revokes.
//
// The `lastUsedAt` stamp is asserted to be AWAITED, which reads like a style test and is not:
// on Workers the isolate can be discarded once the response is returned, so an untracked
// promise may never run and the column then reads "never used" for a live token.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { ApiCaller, ApiCallerEvent } from '@/features/api/auth'
import type { ApiToken } from '@/types/api-token'
import type { EventMembership } from '@/types/domain'

const mocks = vi.hoisted(() => ({
  findApiToken: vi.fn(),
  findApiTokenById: vi.fn(),
  listMembershipsForUser: vi.fn(),
  getEvent: vi.fn(),
  listTaskAssignmentsForEvent: vi.fn(),
  touchApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
  requireEventRole: vi.fn(),
  readApiEvent: vi.fn(),
  readApiSessions: vi.fn(),
  outstandingTaskRows: vi.fn(),
  listAll: vi.fn(),
}))

vi.mock('@/services/airtable/reads-api', () => ({
  findApiToken: mocks.findApiToken,
  findApiTokenById: mocks.findApiTokenById,
}))
vi.mock('@/services/airtable/queries', () => ({
  listMembershipsForUser: mocks.listMembershipsForUser,
  getEvent: mocks.getEvent,
  listTaskAssignmentsForEvent: mocks.listTaskAssignmentsForEvent,
  listSubmissions: vi.fn(async () => await Promise.resolve([])),
}))
vi.mock('@/services/airtable/mutations-api', () => ({
  touchApiToken: mocks.touchApiToken,
  revokeApiToken: mocks.revokeApiToken,
  createApiToken: vi.fn(),
}))
vi.mock('@/services/airtable/client', () => ({ getClient: () => ({ listAll: mocks.listAll }) }))
vi.mock('@/features/auth/wiring', () => ({ requireEventRole: mocks.requireEventRole }))
vi.mock('@/features/api/reads', () => ({
  readApiEvent: mocks.readApiEvent,
  readApiSessions: mocks.readApiSessions,
  readApiEvents: vi.fn(),
  readApiSpeakers: vi.fn(),
}))
vi.mock('@/features/comms/outstanding-tasks', () => ({
  outstandingTaskRows: mocks.outstandingTaskRows,
}))
vi.mock('@/features/tasks/scope', () => ({ acceptedSpeakerScopes: vi.fn(() => []) }))

const { authenticate, callerRoleOn, callerSatisfies, hasScope, ownsToken } = await import(
  '@/features/api/auth'
)
const { isToolFacing, MCP_TOOLS, toolFailure } = await import('@/features/api/mcp-tools')
const { revokeApiTokenAction } = await import('@/features/api/actions')
// The real list read over the mocked client: `importActual` un-mocks this module and leaves
// its own imports mocked, which is exactly the seam the owner filter sits in.
const { listApiTokens } = await vi.importActual<typeof import('@/services/airtable/reads-api')>(
  '@/services/airtable/reads-api',
)

const TOKEN: ApiToken = {
  id: 'tok1',
  name: 'CI',
  tokenHash: 'digest',
  scopes: ['read'],
  ownerId: 'usr1',
  createdAt: '2026-08-01T00:00:00.000Z',
  lastUsedAt: undefined,
  revokedAt: undefined,
}

const membership = (eventId: string, role: 'admin' | 'reviewer'): EventMembership =>
  ({ id: `mem-${eventId}`, eventId, userId: 'usr1', role, addedAt: '2026-01-01' }) as const

const request = () =>
  new Request('https://bodo.test/api/v1/events', {
    headers: { authorization: 'Bearer bodo_whatever' },
  })

const caller = (events: readonly ApiCallerEvent[]): ApiCaller => ({
  tokenId: 'tok1',
  userId: 'usr1',
  scopes: ['read'],
  events,
  eventIds: events.map((event) => event.id),
})

const tool = (name: string) => {
  const found = MCP_TOOLS.find((candidate) => candidate.name === name)
  if (found === undefined) throw new Error(`no tool named ${name}`)
  return found
}

/** The id and message of a rejection, so two refusals can be compared as one value. */
const refusal = async (run: Promise<unknown>): Promise<{ id: string; message: string }> =>
  await run.then(
    () => {
      throw new Error('expected a refusal')
    },
    (error: AppError) => ({ id: error.id, message: error.message }),
  )

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.findApiToken.mockResolvedValue(TOKEN)
  mocks.listMembershipsForUser.mockResolvedValue([membership('e1', 'admin')])
  mocks.touchApiToken.mockResolvedValue(undefined)
})

describe('authenticate', () => {
  it('accepts a token carrying read', async () => {
    expect(await authenticate(request())).toMatchObject({ tokenId: 'tok1', userId: 'usr1' })
  })

  it('refuses a token whose scopes column parsed to nothing, and does not stamp it', async () => {
    // A blank cell, or only values `parseScopes` does not recognise. Both arrive here as [].
    mocks.findApiToken.mockResolvedValue({ ...TOKEN, scopes: [] })
    expect(await authenticate(request())).toBeUndefined()
    expect(mocks.touchApiToken).not.toHaveBeenCalled()
  })

  it('keeps the role held on each event, and derives eventIds from it', async () => {
    mocks.listMembershipsForUser.mockResolvedValue([
      membership('e1', 'admin'),
      membership('e2', 'reviewer'),
    ])
    const authenticated = await authenticate(request())

    expect(authenticated?.events).toEqual([
      { id: 'e1', role: 'admin' },
      { id: 'e2', role: 'reviewer' },
    ])
    expect(authenticated?.eventIds).toEqual(['e1', 'e2'])
  })

  it('awaits the lastUsedAt stamp, so a torn-down isolate cannot lose it', async () => {
    let stamped = false
    mocks.touchApiToken.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      stamped = true
    })

    await authenticate(request())
    // False here is the fire-and-forget version: authenticate returned before the write ran.
    expect(stamped).toBe(true)
  })

  it('does not fail the request when that stamp fails', async () => {
    mocks.touchApiToken.mockRejectedValue(new Error('Airtable said no'))
    expect(await authenticate(request())).toMatchObject({ tokenId: 'tok1' })
  })
})

describe('role helpers', () => {
  const both = caller([
    { id: 'e1', role: 'admin' },
    { id: 'e2', role: 'reviewer' },
  ])

  it('treats a required role as a floor, per event, the way requireEventRole does', () => {
    expect(callerRoleOn(both, 'e2')).toBe('reviewer')
    expect(callerRoleOn(both, 'e3')).toBeUndefined()
    expect(callerSatisfies(both, 'e1', 'admin')).toBe(true)
    expect(callerSatisfies(both, 'e1', 'reviewer')).toBe(true)
    expect(callerSatisfies(both, 'e2', 'reviewer')).toBe(true)
    expect(callerSatisfies(both, 'e2', 'admin')).toBe(false)
    expect(callerSatisfies(both, 'e3', 'reviewer')).toBe(false)
    expect(hasScope({ ...both, scopes: [] }, 'read')).toBe(false)
  })
})

describe('outstanding_tasks requires admin on the event it is asked about', () => {
  beforeEach(() => {
    mocks.readApiEvent.mockImplementation((slug: string, ids: readonly string[]) =>
      Promise.resolve(slug === 'known' && ids.includes('e1') ? { id: 'e1' } : undefined),
    )
    mocks.getEvent.mockResolvedValue({ timezone: 'UTC' })
    mocks.listTaskAssignmentsForEvent.mockResolvedValue([])
    mocks.outstandingTaskRows.mockReturnValue([{ speaker: 'Ada' }])
  })

  it('answers for an admin', async () => {
    const run = tool('outstanding_tasks').run
    expect(await run({ event: 'known' }, caller([{ id: 'e1', role: 'admin' }]))).toEqual([
      { speaker: 'Ada' },
    ])
  })

  it('refuses a reviewer exactly as it refuses an unknown slug, and reads nothing', async () => {
    const asReviewer = await refusal(
      tool('outstanding_tasks').run({ event: 'known' }, caller([{ id: 'e1', role: 'reviewer' }])),
    )
    const unknown = await refusal(
      tool('outstanding_tasks').run({ event: 'nope' }, caller([{ id: 'e1', role: 'admin' }])),
    )

    expect(asReviewer.id).toBe(ErrorIds.DATA_RECORD_NOT_FOUND)
    // Same id AND same wording: anything else lets an agent tell "not yours" from "no such
    // event", which is the enumeration this refusal exists to prevent.
    expect(asReviewer).toEqual({ ...unknown, message: 'no event with slug known' })
    expect(mocks.listTaskAssignmentsForEvent).not.toHaveBeenCalled()
    expect(mocks.getEvent).not.toHaveBeenCalled()
  })

  it('still lets a reviewer read the PUBLISHED schedule', async () => {
    // Deliberate: list_sessions and list_speakers return what the public agenda and the embeds
    // already publish, with no contact details. Requiring admin there would refuse a reviewer
    // data they can read by opening the event's own public page.
    mocks.readApiSessions.mockResolvedValue([{ id: 'sub1' }])
    const run = tool('list_sessions').run
    expect(await run({ event: 'known' }, caller([{ id: 'e1', role: 'reviewer' }]))).toEqual([
      { id: 'sub1' },
    ])
  })

  it('marks only the messages a tool wrote, so the route can suppress the rest', () => {
    expect(isToolFacing(toolFailure(ErrorIds.DATA_RECORD_NOT_FOUND, 'no event with slug x'))).toBe(
      true,
    )
    // The same id off the Airtable client, whose message names a table and carries its own
    // response body in `context`. Unmarked, so `callTool` answers with the id alone.
    expect(isToolFacing(new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'ApiTokens: not found'))).toBe(
      false,
    )
  })
})

describe('token ownership', () => {
  it('is the record link, and an absent record is not owned', () => {
    expect(ownsToken(TOKEN, 'usr1')).toBe(true)
    expect(ownsToken(TOKEN, 'usr2')).toBe(false)
    expect(ownsToken({ ...TOKEN, ownerId: undefined }, 'usr1')).toBe(false)
    expect(ownsToken(undefined, 'usr1')).toBe(false)
  })

  it('lists only the tokens the viewer owns, newest first', async () => {
    mocks.listAll.mockResolvedValue([
      row('tok1', 'usr1', '2026-08-01T00:00:00.000Z'),
      row('tok2', 'usr2', '2026-08-03T00:00:00.000Z'),
      row('tok3', 'usr1', '2026-08-02T00:00:00.000Z'),
    ])
    expect((await listApiTokens('usr1')).map((token) => token.id)).toEqual(['tok3', 'tok1'])
  })
})

describe('revokeApiTokenAction', () => {
  beforeEach(() => {
    mocks.requireEventRole.mockResolvedValue({ userId: 'usr1', role: 'admin' })
    mocks.revokeApiToken.mockResolvedValue(undefined)
  })

  it('revokes a token the caller owns', async () => {
    mocks.findApiTokenById.mockResolvedValue(TOKEN)
    expect(await revokeApiTokenAction('e1', 'tok1')).toMatchObject({ ok: true })
    expect(mocks.revokeApiToken).toHaveBeenCalledWith('tok1', expect.any(String))
  })

  it('refuses a token owned by another organizer, without writing', async () => {
    mocks.findApiTokenById.mockResolvedValue({ ...TOKEN, ownerId: 'usr2' })
    const result = await revokeApiTokenAction('e1', 'tok1')

    expect(result).toMatchObject({ ok: false, errorId: ErrorIds.AUTH_FORBIDDEN_ROLE })
    expect(mocks.revokeApiToken).not.toHaveBeenCalled()
  })

  it('refuses an unknown token the same way, so ids cannot be probed', async () => {
    mocks.findApiTokenById.mockResolvedValue({ ...TOKEN, ownerId: 'usr2' })
    const notMine = await revokeApiTokenAction('e1', 'tok1')
    mocks.findApiTokenById.mockResolvedValue(undefined)

    expect(await revokeApiTokenAction('e1', 'recNoSuchToken')).toEqual(notMine)
  })
})

/** An ApiTokens row as the client hands it back: id plus raw fields. */
function row(id: string, ownerId: string, createdAt: string) {
  return {
    id,
    fields: { name: id, tokenHash: `digest-${id}`, scopes: 'read', owner: [ownerId], createdAt },
  }
}
