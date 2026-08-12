// Shared stand-ins for the Event Team write layer's dependencies.
//
// Not a test file (vitest only collects `tests/**/*.test.ts`): it is the fixture that
// tests/team-authorization.test.ts and tests/team-write.test.ts both use, so the guard being
// exercised and the row shapes cannot drift between them.
//
// The important thing here is `guard()`. It wraps the REAL `requireEventRole` from
// `src/features/auth/guards.ts` with a stub membership loader, so every refusal in those two
// files is the app's own rule and not a re-implementation of it. Which caller is being
// refused is expressed as DATA: the rows the loader answers with, plus the session subject.

import { requireEventRole } from '@/features/auth/guards'
import type { SessionSubject } from '@/features/auth/tokens'
import { teamRows } from '@/features/team/members'
import type { TeamWriteDeps } from '@/features/team/team-write'
import type { AdminUser, EventMembership } from '@/types/domain'

import { ADMIN, T0 } from './auth-fakes'

export const EVENT_A = 'recEventA'
export const EVENT_B = 'recEventB'
/** What `nowIso` answers, so the stamped `addedAt` is assertable. */
export const TEAM_NOW = '2026-08-08T12:00:00.000Z'

export const TEAM_USERS: readonly AdminUser[] = [
  { id: 'recUser1', email: 'sam@example.com', name: 'Sam Organizer' },
  { id: 'recUser2', email: 'rae@example.com', name: 'Rae Reviewer' },
]

/** Event A's team: one admin (recUser1, which is the `ADMIN` fixture) and one reviewer. */
export const TEAM_A: readonly EventMembership[] = [
  { id: 'recMemA1', eventId: EVENT_A, userId: 'recUser1', role: 'admin', addedAt: '2026-01-01' },
  { id: 'recMemA2', eventId: EVENT_A, userId: 'recUser2', role: 'reviewer', addedAt: '2026-01-02' },
]

/** A reviewer's session on event A: recUser2 holds `reviewer` in `TEAM_A`. */
export const REVIEWER: SessionSubject = { kind: 'user', userId: 'recUser2' }

/**
 * The REAL guard, bound to a stub membership loader and wrapped as the dependency the write
 * layer declares.
 *
 * `subject` defaults to the fixture admin session, and `null` is the no-session case: it is
 * `null` rather than `undefined` because an explicit `undefined` would take the default
 * parameter and quietly test the admin path instead. With no subject, `readSubject` is
 * consulted and answers with nothing, so `requireSession` raises `AUTH_NO_SESSION` exactly as
 * it would on a request carrying no cookie.
 */
export function teamGuard(
  rows: readonly EventMembership[],
  subject: SessionSubject | null = ADMIN,
): TeamWriteDeps['requireAdmin'] {
  return async (eventId) =>
    await requireEventRole({
      nowMs: T0,
      subject: subject ?? undefined,
      eventId,
      role: 'admin',
      loadMemberships: (userId) => Promise.resolve(rows.filter((row) => row.userId === userId)),
      readSubject: () => Promise.resolve(undefined),
    })
}

export type TeamRecorder = {
  deps: TeamWriteDeps
  /** Every read, in order, so "was it refused before reading" is answerable. */
  reads: string[]
  /** Every write, in order, so "was anything written" is answerable. */
  writes: string[]
  invites: string[]
}

export type TeamSpyOptions = {
  /** The membership rows the event's list read answers with. Defaults to `TEAM_A`. */
  team?: readonly EventMembership[]
  /** Addresses that already have an `AdminUsers` row. Defaults to `TEAM_USERS`. */
  users?: readonly AdminUser[]
  /** Makes the magic-link invite reject, to check the membership survives it. */
  inviteFails?: boolean
}

export function teamSpyDeps(
  requireAdmin: TeamWriteDeps['requireAdmin'],
  options: TeamSpyOptions = {},
): TeamRecorder {
  const reads: string[] = []
  const writes: string[] = []
  const invites: string[] = []
  const memberships = options.team ?? TEAM_A
  const users = options.users ?? TEAM_USERS

  const deps: TeamWriteDeps = {
    requireAdmin,
    listTeam: (eventId) => {
      reads.push(`team:${eventId}`)
      return Promise.resolve(teamRows({ memberships, users, eventId }))
    },
    findUserByEmail: (email) => {
      reads.push(`user:${email}`)
      return Promise.resolve(users.find((user) => user.email === email))
    },
    createUser: ({ eventId, email }) => {
      writes.push(`createUser:${eventId}:${email}`)
      return Promise.resolve('recUserNew')
    },
    createMembership: (input) => {
      writes.push(`createMembership:${input.eventId}:${input.userId}:${input.role}`)
      return Promise.resolve({ id: 'recMemNew', ...input })
    },
    updateRole: (input) => {
      writes.push(`updateRole:${input.membershipId}:${input.eventId}:${input.userId}:${input.role}`)
      return Promise.resolve()
    },
    removeMembership: (input) => {
      writes.push(`remove:${input.membershipId}:${input.eventId}:${input.userId}`)
      return Promise.resolve()
    },
    invite: (input) => {
      // The role is recorded because the invitation NAMES it, and it must be the role
      // actually written or actually held rather than whatever the client asked for:
      // `resendTeamInvite` takes it from the row for the same reason it takes the address
      // from the row.
      invites.push(`${input.email}:${input.userId}:${input.role}`)
      return options.inviteFails === true
        ? Promise.reject(new Error('provider down'))
        : Promise.resolve({ delivered: true })
    },
    nowIso: () => TEAM_NOW,
  }

  return { deps, reads, writes, invites }
}
