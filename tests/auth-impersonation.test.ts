// Entering and leaving admin-to-portal impersonation.
//
// The role check is the REAL one from guards.ts, bound to a stub membership loader, because
// the properties worth testing are all about who the guard lets through: a speaker cannot
// mint an impersonation session, a reviewer cannot either, and leaving re-reads memberships
// rather than trusting the claim that got the session here.
//
// The session write is a spy, so every case can assert not only the error but that NOTHING
// was established. A refusal that still wrote a cookie would be the whole feature undone.

import { describe, expect, it } from 'vitest'

import { createEventRoleGuards } from '@/features/auth/guards'
import {
  beginImpersonation,
  endImpersonation,
  type RoleCheck,
  type SessionWriter,
} from '@/features/auth/impersonation'
import type { SessionSubject } from '@/features/auth/tokens'
import type { EventMembership } from '@/types/domain'

import {
  ADMIN,
  errorIdOf,
  fakeMembershipLoader,
  IMPERSONATED,
  IMPERSONATED_NO_GRANT,
  membershipRow,
  SPEAKER,
  T0,
} from './helpers/auth-fakes'

const EVENT = 'recEventA'
const OTHER_EVENT = 'recEventB'
const TARGET = 'recSpeaker2'

/** The event's Speakers rows, in the shape the DAL's `listSpeakers` returns. */
const ROSTER = [{ id: 'recSpeaker1' }, { id: TARGET }]

function writer(): SessionWriter & { established: SessionSubject[] } {
  const established: SessionSubject[] = []
  const establish = (input: { subject: SessionSubject; nowMs: number }) => {
    established.push(input.subject)
    return Promise.resolve()
  }
  return Object.assign(establish, { established })
}

/** The role check exactly as wiring.ts binds it: real guard, stubbed memberships. */
function roleCheck(rows: readonly EventMembership[]): {
  requireEventRole: RoleCheck
  calls: string[]
} {
  const loadMemberships = fakeMembershipLoader(rows)
  const guards = createEventRoleGuards({ loadMemberships })
  return {
    requireEventRole: async (input) => await guards.requireEventRole({ nowMs: T0, ...input }),
    calls: loadMemberships.calls,
  }
}

function enter(options: {
  subject: SessionSubject | undefined
  rows: readonly EventMembership[]
  eventId?: string
  speakerId?: string
  portalEventId?: string
  roster?: readonly { id: string }[]
}) {
  const establish = writer()
  const { requireEventRole, calls } = roleCheck(options.rows)
  const rosterCalls: string[] = []

  const run = async () =>
    await beginImpersonation({
      eventId: options.eventId ?? EVENT,
      speakerId: options.speakerId ?? TARGET,
      portalEventId: options.portalEventId ?? EVENT,
      nowMs: T0,
      subject: options.subject,
      requireEventRole,
      listEventSpeakers: (eventId) => {
        rosterCalls.push(eventId)
        return Promise.resolve(options.roster ?? ROSTER)
      },
      establish,
      newGrantId: () => 'grant-1',
    })

  return { run, establish, calls, rosterCalls }
}

describe('beginImpersonation', () => {
  it('establishes a speaker session carrying the originating admin id', async () => {
    const entry = enter({ subject: ADMIN, rows: [membershipRow(EVENT, 'admin')] })

    expect(await entry.run()).toEqual({ userId: 'recUser1', speakerId: TARGET })
    expect(entry.establish.established).toEqual([
      {
        kind: 'speaker',
        speakerId: TARGET,
        impersonatorUserId: 'recUser1',
        // The single-use grant, minted here so the way back can prove the bearer rather
        // than only naming an admin. See the note in tokens.ts.
        impersonationGrantId: 'grant-1',
      },
    ])
    // Capability came from EventMemberships on this request, not from the cookie.
    expect(entry.calls).toEqual(['recUser1'])
    expect(entry.rosterCalls).toEqual([EVENT])
  })

  it('refuses a speaker: nobody can promote themselves into acting as somebody else', async () => {
    const entry = enter({ subject: SPEAKER, rows: [membershipRow(EVENT, 'admin')] })

    expect(await errorIdOf(entry.run)).toBe('E_AUTH_005')
    expect(entry.establish.established).toEqual([])
  })

  it('refuses a session that is already impersonating, so it cannot be re-entered', async () => {
    const entry = enter({ subject: IMPERSONATED, rows: [membershipRow(EVENT, 'admin')] })

    expect(await errorIdOf(entry.run)).toBe('E_AUTH_005')
    expect(entry.establish.established).toEqual([])
  })

  it('refuses a reviewer: deciding to act as somebody is an organizer power', async () => {
    const entry = enter({ subject: ADMIN, rows: [membershipRow(EVENT, 'reviewer')] })

    expect(await errorIdOf(entry.run)).toBe('E_AUTH_005')
    expect(entry.establish.established).toEqual([])
  })

  it('refuses an admin on another event', async () => {
    const entry = enter({ subject: ADMIN, rows: [membershipRow(OTHER_EVENT, 'admin')] })

    expect(await errorIdOf(entry.run)).toBe('E_AUTH_005')
    expect(entry.establish.established).toEqual([])
  })

  it('refuses an unauthenticated caller', async () => {
    const entry = enter({ subject: undefined, rows: [membershipRow(EVENT, 'admin')] })

    expect(await errorIdOf(entry.run)).toBe('E_AUTH_004')
    expect(entry.establish.established).toEqual([])
  })

  it('refuses a target who is not a speaker on the event', async () => {
    const entry = enter({
      subject: ADMIN,
      rows: [membershipRow(EVENT, 'admin')],
      speakerId: 'recSpeakerElsewhere',
    })

    expect(await errorIdOf(entry.run)).toBe('E_DATA_001')
    expect(entry.establish.established).toEqual([])
  })

  it('refuses an event the portal does not serve, since the portal would show another one', async () => {
    const entry = enter({
      subject: ADMIN,
      rows: [membershipRow(EVENT, 'admin')],
      portalEventId: OTHER_EVENT,
    })

    expect(await errorIdOf(entry.run)).toBe('E_AUTH_007')
    expect(entry.establish.established).toEqual([])
  })
})

/**
 * A ClaimGuard stand-in with the real semantics: first holder wins, a later DIFFERENT
 * holder is refused. That is what makes the grant single-use, so a stub that always grants
 * would make the replay test vacuous.
 */
function claimGuard() {
  const held = new Map<string, string>()
  const keys: string[] = []
  const claim = (key: string, holder: string) => {
    keys.push(key)
    const existing = held.get(key)
    if (existing === undefined) {
      held.set(key, holder)
      return Promise.resolve({ granted: true })
    }
    return Promise.resolve({ granted: existing === holder })
  }
  return { claim, keys }
}

function leave(options: {
  subject: SessionSubject
  rows: readonly EventMembership[]
  eventId?: string
  guard?: ReturnType<typeof claimGuard>
  /**
   * The claim holder. Distinct per exit ATTEMPT, which is what production does: `wiring.ts`
   * passes a fresh `crypto.randomUUID()`. It matters because ClaimGuard is idempotent for
   * the same holder, so reusing one would make a replay look granted and the test vacuous.
   */
  holder?: string
}) {
  const establish = writer()
  const { requireEventRole, calls } = roleCheck(options.rows)
  const guard = options.guard ?? claimGuard()

  const run = async () =>
    await endImpersonation({
      eventId: options.eventId ?? EVENT,
      subject: options.subject,
      nowMs: T0,
      requireEventRole,
      establish,
      claim: guard.claim,
      newGrantId: () => options.holder ?? 'holder-1',
    })

  return { run, establish, calls, guard }
}

describe('endImpersonation', () => {
  it('restores the admin session named by the claim', async () => {
    const exit = leave({ subject: IMPERSONATED, rows: [membershipRow(EVENT, 'admin')] })

    expect(await exit.run()).toEqual({ userId: 'recUser1' })
    expect(exit.establish.established).toEqual([{ kind: 'user', userId: 'recUser1' }])
    expect(exit.calls).toEqual(['recUser1'])
  })

  it('re-checks the role, because the claim proves who started and not what they hold', async () => {
    // Same signed claim, membership revoked mid-session. The way back closes.
    const exit = leave({ subject: IMPERSONATED, rows: [] })

    expect(await errorIdOf(exit.run)).toBe('E_AUTH_005')
    expect(exit.establish.established).toEqual([])
    expect(exit.calls).toEqual(['recUser1'])
  })

  it('refuses a demotion to reviewer, so the way back is not a way up', async () => {
    const exit = leave({ subject: IMPERSONATED, rows: [membershipRow(EVENT, 'reviewer')] })

    expect(await errorIdOf(exit.run)).toBe('E_AUTH_005')
    expect(exit.establish.established).toEqual([])
  })

  it('refuses an ordinary speaker session, which carries no claim to return with', async () => {
    const exit = leave({ subject: SPEAKER, rows: [membershipRow(EVENT, 'admin')] })

    expect(await errorIdOf(exit.run)).toBe('E_AUTH_007')
    expect(exit.establish.established).toEqual([])
    expect(exit.calls).toEqual([])
  })

  it('refuses an admin session, which is already where the way back leads', async () => {
    const exit = leave({ subject: ADMIN, rows: [membershipRow(EVENT, 'admin')] })

    expect(await errorIdOf(exit.run)).toBe('E_AUTH_007')
    expect(exit.establish.established).toEqual([])
  })
})

describe('the single-use grant, found by Codex review', () => {
  // The escalation this closes: re-reading EventMemberships proves the NAMED USER still
  // holds admin. It proves nothing about whether the bearer of the cookie is that user, so
  // a copy of a speaker-level impersonation cookie could be exchanged for the organizer's
  // ADMIN session, which is an elevation past what the cookie was stolen as.

  it('lets the organizer back exactly once', async () => {
    const guard = claimGuard()
    const first = leave({ subject: IMPERSONATED, rows: [membershipRow(EVENT, 'admin')], guard })

    expect(await first.run()).toEqual({ userId: 'recUser1' })
    expect(guard.keys).toEqual(['impersonation:grant-1'])
  })

  it('refuses a replay of the same cookie, so it cannot be exchanged for admin twice', async () => {
    // Two separate exits carrying the SAME signed session, which is what a stolen copy is.
    // The second finds the grant spent.
    const guard = claimGuard()
    const first = leave({
      subject: IMPERSONATED,
      rows: [membershipRow(EVENT, 'admin')],
      guard,
      holder: 'organizer-tab',
    })
    const replay = leave({
      subject: IMPERSONATED,
      rows: [membershipRow(EVENT, 'admin')],
      guard,
      holder: 'stolen-copy',
    })

    await first.run()

    expect(await errorIdOf(replay.run)).toBe('E_AUTH_007')
    expect(replay.establish.established).toEqual([])
    // No membership read either: the grant is spent before the role is looked up, so a
    // replay cannot spend a read or be timed against a role refusal.
    expect(replay.calls).toEqual([])
  })

  it('refuses a session that names an admin but carries no grant', async () => {
    // A hand-built or downgraded token: `imp` present, `impg` absent. tokens.ts already
    // drops the pair unless both are there, and this is the guard behind that.
    const exit = leave({
      subject: IMPERSONATED_NO_GRANT,
      rows: [membershipRow(EVENT, 'admin')],
    })

    expect(await errorIdOf(exit.run)).toBe('E_AUTH_007')
    expect(exit.establish.established).toEqual([])
    expect(exit.calls).toEqual([])
  })
})
