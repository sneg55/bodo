// Shared stand-ins for the three things src/features/auth takes as arguments: the
// ClaimGuard claim, the email send, and the session write. Not a test file (vitest
// only collects `tests/**/*.test.ts`), just the fixtures those tests share.

import { isAppError } from '@/constants/errorIds'
import type { MembershipLoader } from '@/features/auth/guards'
import type { ClaimFn } from '@/features/auth/magic-link'
import type { SessionSubject } from '@/features/auth/tokens'
import type { EventMembership } from '@/types/domain'

export const T0 = 1_754_600_000_000 // fixed epoch ms; nothing in these tests reads the clock
export const SECRET = new TextEncoder().encode('test-secret-at-least-32-bytes-long!!')
export const ORIGIN = 'https://bodo.example'

export const SPEAKER: SessionSubject = { kind: 'speaker', speakerId: 'recSpeaker1' }
export const ADMIN: SessionSubject = { kind: 'user', userId: 'recUser1' }

/** A speaker session an organizer entered through the admin bar's View Portal control. */
export const IMPERSONATED: SessionSubject = {
  kind: 'speaker',
  speakerId: 'recSpeaker1',
  impersonatorUserId: 'recUser1',
  /** Both claims, because the way back needs a live grant as well as a named admin. */
  impersonationGrantId: 'grant-1',
}

/** An impersonated session whose grant is missing: named admin, no way to prove the bearer. */
export const IMPERSONATED_NO_GRANT: SessionSubject = {
  kind: 'speaker',
  speakerId: 'recSpeaker1',
  impersonatorUserId: 'recUser1',
}

export function membershipRow(
  eventId: string,
  role: 'admin' | 'reviewer',
  userId = 'recUser1',
): EventMembership {
  return { id: `recM-${eventId}-${role}`, eventId, userId, role, addedAt: '2026-01-01' }
}

/** Records what it was asked for, so a test can assert the guard queried by user id. */
export function fakeMembershipLoader(
  rows: readonly EventMembership[],
): MembershipLoader & { calls: string[] } {
  const calls: string[] = []
  const loader = (userId: string) => {
    calls.push(userId)
    return Promise.resolve(rows.filter((row) => row.userId === userId))
  }
  return Object.assign(loader, { calls })
}

/**
 * Runs `run` and reports the AppError id it threw, so a test asserts on the id from
 * src/constants/errorIds rather than on a message string.
 */
export async function errorIdOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (caught) {
    return isAppError(caught) ? caught.id : `unexpected: ${String(caught)}`
  }
  return 'no error thrown'
}

/** The synchronous form, for the guards that are pure. */
export function syncErrorIdOf(run: () => unknown): string {
  try {
    run()
  } catch (caught) {
    return isAppError(caught) ? caught.id : `unexpected: ${String(caught)}`
  }
  return 'no error thrown'
}

/**
 * Same contract as `claimOnce` in src/utils/cf.ts, in one process: a live claim held
 * by a different holder loses, and the SAME holder wins again. That last part is
 * deliberate in the real guard (a retried outbox send must not deadlock on its own
 * lease) and it is exactly why the magic-link consumer needs a per-attempt holder.
 */
export function fakeGuard(nowMs: number): {
  claim: ClaimFn
  held: Map<string, { holder: string; expiresAt: number }>
} {
  const held = new Map<string, { holder: string; expiresAt: number }>()
  const claim: ClaimFn = (key, holder, ttlMs) => {
    const existing = held.get(key)
    if (existing !== undefined && existing.expiresAt > nowMs) {
      if (existing.holder === holder) return Promise.resolve({ granted: true })
      return Promise.resolve({ granted: false, heldBy: existing.holder })
    }
    held.set(key, { holder, expiresAt: nowMs + ttlMs })
    return Promise.resolve({ granted: true })
  }
  return { claim, held }
}

export type SentMessage = {
  to: string
  subject: string
  html: string
  idempotencyKey?: string
}

export function fakeSender(): {
  sent: SentMessage[]
  send: (message: {
    to: string | readonly string[]
    subject: string
    html: string
    idempotencyKey?: string
  }) => Promise<{ delivered: boolean; messageId: string }>
} {
  const sent: SentMessage[] = []
  return {
    sent,
    send: (message) => {
      sent.push({
        to: typeof message.to === 'string' ? message.to : message.to.join(','),
        subject: message.subject,
        html: message.html,
        idempotencyKey: message.idempotencyKey,
      })
      return Promise.resolve({ delivered: true, messageId: `msg-${sent.length}` })
    },
  }
}

export function fakeEstablisher(): {
  established: SessionSubject[]
  establish: (input: { subject: SessionSubject; nowMs: number }) => Promise<void>
} {
  const established: SessionSubject[] = []
  return {
    established,
    establish: (input) => {
      established.push(input.subject)
      return Promise.resolve()
    },
  }
}
