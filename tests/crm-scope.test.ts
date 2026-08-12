// The CRM's read scope.
//
// Two halves, tested differently. `scopeFromMemberships` is the rule and is pure, so it is
// called directly. `crmScopeForViewer` is the wiring, and the branch worth pinning there is
// its catch: it is what decides redirect-to-login against an unhandled 500 on every CRM
// page load, and it distinguishes on an error id prefix, which is exactly the kind of test
// a refactor breaks silently.
//
// The membership fixture carries more fields than the function reads, deliberately. Scope
// depends on `eventId` and nothing else, so the signature asks for nothing else, and a
// fixture with the extra fields proves that rather than asserting it in a comment.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  listMembershipsForUser: vi.fn(),
}))

vi.mock('@/features/auth/wiring', () => ({ requireAdminUser: mocks.requireAdminUser }))
vi.mock('@/services/airtable/queries', () => ({
  listMembershipsForUser: mocks.listMembershipsForUser,
}))

const { AppError, ErrorIds } = await import('@/constants/errorIds')
const { crmScopeForViewer, scopeFromMemberships } = await import('@/features/crm/scope')

/** `EVENT_ROLES` is ['admin', 'reviewer'] (constants/status.ts). */
const membership = (eventId: string, role: 'admin' | 'reviewer' = 'admin') => ({
  id: `mem_${eventId}`,
  eventId,
  userId: 'usr1',
  role,
})

describe('scopeFromMemberships', () => {
  it('collects every event the user belongs to', () => {
    const scope = scopeFromMemberships('usr1', [membership('e1'), membership('e2')])
    expect(scope?.eventIds).toEqual(['e1', 'e2'])
  })

  it('uses the first membership as the chrome context', () => {
    expect(scopeFromMemberships('usr1', [membership('e1'), membership('e2')])?.contextEventId).toBe(
      'e1',
    )
  })

  it('returns undefined with no memberships, so the layout can 404', () => {
    // Deliberately not an empty scope: telling someone events exist but are not theirs
    // is information they did not have.
    expect(scopeFromMemberships('usr1', [])).toBeUndefined()
  })

  it('deduplicates repeated events', () => {
    expect(scopeFromMemberships('usr1', [membership('e1'), membership('e1')])?.eventIds).toEqual([
      'e1',
    ])
  })

  it('carries the user through, so a read never has to ask twice', () => {
    expect(scopeFromMemberships('usr1', [membership('e1')])?.userId).toBe('usr1')
  })

  it('keeps a reviewer-only event readable', () => {
    // The whole point of computing the two separately: a reviewer sees the CRM.
    const scope = scopeFromMemberships('usr1', [membership('e1', 'reviewer')])
    expect(scope?.eventIds).toEqual(['e1'])
  })

  it('leaves a reviewer-only event out of the writable set', () => {
    expect(scopeFromMemberships('usr1', [membership('e1', 'reviewer')])?.adminEventIds).toEqual([])
  })

  it('collects only the events held as admin, in the same order', () => {
    const scope = scopeFromMemberships('usr1', [
      membership('e1', 'reviewer'),
      membership('e2'),
      membership('e3'),
    ])
    expect(scope?.adminEventIds).toEqual(['e2', 'e3'])
  })

  it('makes an event with both memberships writable', () => {
    // Two rows on one event with different roles is not a shape the app creates, but the
    // guard the action runs answers "admin" to it, and disagreeing with that guard is how a
    // button appears that every click refuses (or fails to appear when the write would work).
    const scope = scopeFromMemberships('usr1', [
      membership('e1', 'reviewer'),
      membership('e1', 'admin'),
    ])
    expect(scope?.adminEventIds).toEqual(['e1'])
  })

  it('never names an event that is not in the read scope', () => {
    const scope = scopeFromMemberships('usr1', [membership('e1'), membership('e2', 'reviewer')])
    const readable = new Set(scope?.eventIds)
    expect(scope?.adminEventIds.every((eventId) => readable.has(eventId))).toBe(true)
  })
})

describe('crmScopeForViewer', () => {
  beforeEach(() => {
    mocks.requireAdminUser.mockReset()
    mocks.listMembershipsForUser.mockReset()
  })

  it('answers anonymous when the session guard refuses, so the layout can redirect', () => {
    mocks.requireAdminUser.mockRejectedValue(
      new AppError(ErrorIds.AUTH_NO_SESSION, 'no admin session'),
    )
    return expect(crmScopeForViewer()).resolves.toBe('anonymous')
  })

  it('answers anonymous for any E_AUTH id, not just the one', () => {
    // The catch tests the PREFIX, so an expired token has to land in the same place as a
    // missing session: both mean "sign in again", and neither is a 500.
    mocks.requireAdminUser.mockRejectedValue(
      new AppError(ErrorIds.AUTH_TOKEN_EXPIRED, 'token expired'),
    )
    return expect(crmScopeForViewer()).resolves.toBe('anonymous')
  })

  it('rethrows anything that is not an AppError', async () => {
    // An Airtable outage must not read as "you are signed out", which would bounce an
    // organizer to the login page and lose the fact that the data layer is down.
    mocks.requireAdminUser.mockRejectedValue(new TypeError('fetch failed'))
    await expect(crmScopeForViewer()).rejects.toThrow('fetch failed')
  })

  it('rethrows an AppError from another family', async () => {
    mocks.requireAdminUser.mockResolvedValue({ userId: 'usr1' })
    mocks.listMembershipsForUser.mockRejectedValue(
      new AppError(ErrorIds.NET_BAD_SHAPE, 'EventMemberships: read rejected'),
    )
    await expect(crmScopeForViewer()).rejects.toThrow('EventMemberships: read rejected')
  })

  it('returns the scope when the viewer holds a membership', async () => {
    mocks.requireAdminUser.mockResolvedValue({ userId: 'usr1' })
    mocks.listMembershipsForUser.mockResolvedValue([membership('e1'), membership('e2')])
    await expect(crmScopeForViewer()).resolves.toEqual({
      userId: 'usr1',
      eventIds: ['e1', 'e2'],
      adminEventIds: ['e1', 'e2'],
      contextEventId: 'e1',
    })
  })

  it('returns undefined for a signed-in viewer with no membership', async () => {
    mocks.requireAdminUser.mockResolvedValue({ userId: 'usr1' })
    mocks.listMembershipsForUser.mockResolvedValue([])
    await expect(crmScopeForViewer()).resolves.toBeUndefined()
  })
})
