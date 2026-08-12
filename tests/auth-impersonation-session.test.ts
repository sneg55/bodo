// What an impersonated session can and cannot reach.
//
// Impersonation works by ACTING AS A SPEAKER SESSION (src/features/auth/guards.ts), so the
// only thing the extra claim may buy is a way back. Every case here asks the same question
// from a different direction: while the session is acting as a speaker, is it still refused
// everywhere a speaker is refused? A yes anywhere below would be self-elevation.

import { describe, expect, it } from 'vitest'

import {
  requireAdminUser,
  requireEventRole,
  requireSpeaker,
  requireSpeakerOwnership,
} from '@/features/auth/guards'

import {
  errorIdOf,
  fakeMembershipLoader,
  IMPERSONATED,
  membershipRow,
  syncErrorIdOf,
  T0,
} from './helpers/auth-fakes'

const EVENT_A = 'recEventA'

describe('an impersonated session', () => {
  it('is a speaker, and hands the originating admin id back for the way out', async () => {
    expect(await requireSpeaker({ nowMs: T0, subject: IMPERSONATED })).toEqual({
      speakerId: 'recSpeaker1',
      impersonatorUserId: 'recUser1',
    })
  })

  it('is refused by requireAdminUser, so no admin surface opens while it acts', async () => {
    expect(
      await errorIdOf(async () => await requireAdminUser({ nowMs: T0, subject: IMPERSONATED })),
    ).toBe('E_AUTH_005')
  })

  it('holds no event role, and its memberships are never even looked up', async () => {
    // The originating admin IS an admin on this event. That must not leak through the
    // session they are acting inside, which is why the loader has to stay untouched.
    const loadMemberships = fakeMembershipLoader([membershipRow(EVENT_A, 'admin')])

    expect(
      await errorIdOf(
        async () =>
          await requireEventRole({
            nowMs: T0,
            subject: IMPERSONATED,
            eventId: EVENT_A,
            role: 'reviewer',
            loadMemberships,
          }),
      ),
    ).toBe('E_AUTH_005')
    expect(loadMemberships.calls).toEqual([])
  })

  it('owns the records of the speaker it is acting as, and nobody else', () => {
    expect(
      requireSpeakerOwnership({
        actor: IMPERSONATED,
        ownerSpeakerId: 'recSpeaker1',
        resource: 'submission recSub1',
      }),
    ).toBe('recSpeaker1')
    expect(
      syncErrorIdOf(() =>
        requireSpeakerOwnership({
          actor: IMPERSONATED,
          ownerSpeakerId: 'recSpeaker2',
          resource: 'submission recSub2',
        }),
      ),
    ).toBe('E_AUTH_005')
  })
})
