// The guards, exercised the way an entry point calls them: with an identity handed
// in. Memberships come from a stub loader, which is exactly the shape the Airtable
// DAL has to supply, so this file doubles as the contract for that function.

import { describe, expect, it } from 'vitest'

import {
  createEventRoleGuards,
  eventRoleOf,
  type MembershipLoader,
  requireAdminUser,
  requireEventRole,
  requireSession,
  requireSpeaker,
  requireSpeakerOwnership,
  roleSatisfies,
} from '@/features/auth/guards'
import type { EventMembership } from '@/types/domain'

import { ADMIN, errorIdOf, SPEAKER, syncErrorIdOf, T0 } from './helpers/auth-fakes'

const EVENT_A = 'recEventA'
const EVENT_B = 'recEventB'

function membership(eventId: string, role: 'admin' | 'reviewer'): EventMembership {
  return { id: `recM-${eventId}-${role}`, eventId, userId: 'recUser1', role, addedAt: '2026-01-01' }
}

/** Records what it was asked for, so the tests can assert the guard queried by user id. */
function stubLoader(rows: readonly EventMembership[]): MembershipLoader & { calls: string[] } {
  const calls: string[] = []
  const loader = (userId: string) => {
    calls.push(userId)
    return Promise.resolve(rows.filter((row) => row.userId === userId))
  }
  return Object.assign(loader, { calls })
}

describe('requireSession', () => {
  it('returns an identity that was passed in, without touching a cookie store', async () => {
    expect(await requireSession({ nowMs: T0, subject: SPEAKER })).toEqual(SPEAKER)
  })

  it('falls back to the injected reader when no subject was passed', async () => {
    const resolved = await requireSession({
      nowMs: T0,
      readSubject: () => Promise.resolve(ADMIN),
    })

    expect(resolved).toEqual(ADMIN)
  })

  it('throws AUTH_NO_SESSION when nothing identifies the caller', async () => {
    expect(
      await errorIdOf(
        async () =>
          await requireSession({ nowMs: T0, readSubject: () => Promise.resolve(undefined) }),
      ),
    ).toBe('E_AUTH_004')
  })
})

describe('requireSpeaker and requireAdminUser', () => {
  it('accepts the matching subject kind', async () => {
    expect(await requireSpeaker({ nowMs: T0, subject: SPEAKER })).toEqual({
      speakerId: 'recSpeaker1',
    })
    expect(await requireAdminUser({ nowMs: T0, subject: ADMIN })).toEqual({ userId: 'recUser1' })
  })

  it('refuses an admin session on a portal entry point', async () => {
    expect(await errorIdOf(async () => await requireSpeaker({ nowMs: T0, subject: ADMIN }))).toBe(
      'E_AUTH_005',
    )
  })

  it('refuses a speaker session on an admin entry point', async () => {
    expect(
      await errorIdOf(async () => await requireAdminUser({ nowMs: T0, subject: SPEAKER })),
    ).toBe('E_AUTH_005')
  })
})

describe('roleSatisfies', () => {
  it('treats admin as covering reviewer, and reviewer as not covering admin', () => {
    expect(roleSatisfies('admin', 'reviewer')).toBe(true)
    expect(roleSatisfies('admin', 'admin')).toBe(true)
    expect(roleSatisfies('reviewer', 'reviewer')).toBe(true)
    expect(roleSatisfies('reviewer', 'admin')).toBe(false)
  })
})

describe('requireEventRole', () => {
  it('resolves the role from memberships rather than from the session', async () => {
    const loadMemberships = stubLoader([membership(EVENT_A, 'admin')])

    const identity = await requireEventRole({
      nowMs: T0,
      subject: ADMIN,
      eventId: EVENT_A,
      role: 'admin',
      loadMemberships,
    })

    expect(identity).toEqual({ userId: 'recUser1', role: 'admin' })
    expect(loadMemberships.calls).toEqual(['recUser1'])
  })

  it('lets an event admin through a reviewer-only requirement', async () => {
    const identity = await requireEventRole({
      nowMs: T0,
      subject: ADMIN,
      eventId: EVENT_A,
      role: 'reviewer',
      loadMemberships: stubLoader([membership(EVENT_A, 'admin')]),
    })

    expect(identity.role).toBe('admin')
  })

  it('refuses a reviewer on an admin-only requirement', async () => {
    expect(
      await errorIdOf(
        async () =>
          await requireEventRole({
            nowMs: T0,
            subject: ADMIN,
            eventId: EVENT_A,
            role: 'admin',
            loadMemberships: stubLoader([membership(EVENT_A, 'reviewer')]),
          }),
      ),
    ).toBe('E_AUTH_005')
  })

  it('scopes the role to one event, so admin on B is nobody on A', async () => {
    expect(
      await errorIdOf(
        async () =>
          await requireEventRole({
            nowMs: T0,
            subject: ADMIN,
            eventId: EVENT_A,
            role: 'reviewer',
            loadMemberships: stubLoader([membership(EVENT_B, 'admin')]),
          }),
      ),
    ).toBe('E_AUTH_005')
  })

  it('refuses a caller with no memberships at all', async () => {
    expect(
      await errorIdOf(
        async () =>
          await requireEventRole({
            nowMs: T0,
            subject: ADMIN,
            eventId: EVENT_A,
            role: 'reviewer',
            loadMemberships: stubLoader([]),
          }),
      ),
    ).toBe('E_AUTH_005')
  })

  it('never consults memberships for a speaker subject', async () => {
    const loadMemberships = stubLoader([membership(EVENT_A, 'admin')])

    expect(
      await errorIdOf(
        async () =>
          await requireEventRole({
            nowMs: T0,
            subject: SPEAKER,
            eventId: EVENT_A,
            role: 'admin',
            loadMemberships,
          }),
      ),
    ).toBe('E_AUTH_005')
    expect(loadMemberships.calls).toEqual([])
  })
})

describe('eventRoleOf', () => {
  it('returns the held role, and undefined for no membership', async () => {
    const loadMemberships = stubLoader([membership(EVENT_A, 'reviewer')])

    expect(
      await eventRoleOf({ nowMs: T0, subject: ADMIN, eventId: EVENT_A, loadMemberships }),
    ).toBe('reviewer')
    expect(
      await eventRoleOf({ nowMs: T0, subject: ADMIN, eventId: EVENT_B, loadMemberships }),
    ).toBeUndefined()
  })
})

describe('createEventRoleGuards', () => {
  it('binds the loader so call sites only pass the event and the role', async () => {
    const guards = createEventRoleGuards({
      loadMemberships: stubLoader([membership(EVENT_A, 'admin')]),
    })

    expect(await guards.eventRoleOf({ nowMs: T0, subject: ADMIN, eventId: EVENT_A })).toBe('admin')
    expect(
      (
        await guards.requireEventRole({
          nowMs: T0,
          subject: ADMIN,
          eventId: EVENT_A,
          role: 'admin',
        })
      ).userId,
    ).toBe('recUser1')
  })
})

describe('requireSpeakerOwnership', () => {
  it('returns the owner id when the acting speaker owns the record', () => {
    expect(
      requireSpeakerOwnership({
        actor: SPEAKER,
        ownerSpeakerId: 'recSpeaker1',
        resource: 'submission recSub1',
      }),
    ).toBe('recSpeaker1')
  })

  it('refuses another speaker, which is the portal mutation case that matters', () => {
    const id = syncErrorIdOf(() =>
      requireSpeakerOwnership({
        actor: SPEAKER,
        ownerSpeakerId: 'recSpeaker2',
        resource: 'submission recSub1',
      }),
    )

    expect(id).toBe('E_AUTH_005')
  })

  it('refuses an admin subject: impersonation acts as a speaker, not as a user', () => {
    const id = syncErrorIdOf(() =>
      requireSpeakerOwnership({
        actor: ADMIN,
        ownerSpeakerId: 'recSpeaker1',
        resource: 'submission recSub1',
      }),
    )

    expect(id).toBe('E_AUTH_005')
  })
})
