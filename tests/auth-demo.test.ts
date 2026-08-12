// Demo sign-in. One property carries the feature and the first three cases pin it:
//
//   demo mode changes how a visitor proves who they are, never who exists.
//
// So every case here that could have been served by inventing a subject asserts that
// nothing was invented instead: an address with no row signs nobody in, and the
// reviewer button mints the same kind of subject the organizer button does, leaving
// EventMemberships to decide what it can reach.
//
// The rest is the env schema, where demo mode is the one configuration allowed to
// deploy to production without a mailbox, and must not relax anything else.

import { describe, expect, it, vi } from 'vitest'

import { ErrorIds, isAppError } from '@/constants/errorIds'
import {
  audienceFor,
  type DemoEmails,
  emailFor,
  isDemoPersona,
  signInAsDemoPersona,
} from '@/features/auth/demo-login'
import { mintSessionToken, type SessionSubject, verifySessionToken } from '@/features/auth/tokens'
import type { EventMembership } from '@/types/domain'
import { parseEnv } from '@/utils/env'

import { SECRET, T0 } from './helpers/auth-fakes'

const EMAILS: DemoEmails = {
  admin: 'organizer@example.com',
  reviewer: 'reviewer1@example.com',
  speaker: 'ada@example.com',
}

const MEMBERSHIP: EventMembership = {
  id: 'fixMem1',
  eventId: 'fixEvent1',
  userId: 'fixUser1',
  role: 'admin',
  addedAt: '2026-08-01T00:00:00.000Z',
}

/** A resolver over a fixed table, standing in for the real AdminUsers/Speakers lookup. */
function resolverFor(table: ReadonlyMap<string, SessionSubject>) {
  return vi.fn(({ email }: { email: string }) => Promise.resolve(table.get(email)))
}

const KNOWN = new Map<string, SessionSubject>([
  ['organizer@example.com', { kind: 'user', userId: 'fixUser1' }],
  ['reviewer1@example.com', { kind: 'user', userId: 'fixUser2' }],
  ['ada@example.com', { kind: 'speaker', speakerId: 'fixSpk1' }],
])

/** The events the fixture memberships point at, by id. Absent means unreadable. */
const EVENTS = new Map<string, { status: 'open' | 'closed' | 'draft'; slug: string }>([
  ['fixEvent1', { status: 'open', slug: 'fix-event-one' }],
  ['fixEvent2', { status: 'draft', slug: 'fix-event-two' }],
])

function harness(options?: {
  resolve?: ReturnType<typeof resolverFor>
  memberships?: readonly EventMembership[]
  events?: ReadonlyMap<string, { status: 'open' | 'closed' | 'draft'; slug: string }>
}) {
  const establish = vi.fn(() => Promise.resolve())
  const loadMemberships = vi.fn(() => Promise.resolve(options?.memberships ?? [MEMBERSHIP]))
  const resolveSubject = options?.resolve ?? resolverFor(KNOWN)
  const readEvent = vi.fn((eventId: string) =>
    Promise.resolve((options?.events ?? EVENTS).get(eventId)),
  )
  return {
    establish,
    loadMemberships,
    readEvent,
    resolveSubject,
    run: async (persona: 'admin' | 'reviewer' | 'speaker') =>
      await signInAsDemoPersona({
        persona,
        emails: EMAILS,
        nowMs: 1_760_000_000_000,
        resolveSubject,
        establish,
        loadMemberships,
        readEvent,
      }),
  }
}

async function failureOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return isAppError(error) ? error.id : `not an AppError: ${String(error)}`
  }
  throw new Error('expected the sign-in to be refused')
}

describe('demo sign-in resolves real identities and invents none', () => {
  it('refuses a configured address that has no row, and writes no session', async () => {
    const h = harness({ resolve: resolverFor(new Map()) })

    expect(await failureOf(h.run('admin'))).toBe(ErrorIds.AUTH_DEMO_IDENTITY_MISSING)
    // The half that matters: refusing is only meaningful if nothing was minted anyway.
    expect(h.establish).not.toHaveBeenCalled()
  })

  it('signs in as whatever subject the shared resolver returns', async () => {
    const h = harness()
    await h.run('speaker')

    expect(h.establish).toHaveBeenCalledWith({
      subject: { kind: 'speaker', speakerId: 'fixSpk1', viaDemo: true },
      nowMs: 1_760_000_000_000,
    })
  })

  it('marks the session, so turning demo mode off can revoke it', async () => {
    // Without the mark, DEMO_MODE=0 removes the button and 404s the endpoint while every
    // session already handed out keeps working for its full 30 days.
    const h = harness()
    await h.run('admin')

    const [call] = h.establish.mock.calls as unknown as [[{ subject: { viaDemo?: true } }]]
    expect(call[0].subject.viaDemo).toBe(true)
  })

  it('gives the reviewer button no more than the organizer button', async () => {
    // Both are plain `user` subjects. A reviewer-specific capability baked in here
    // would be a capability that did not come from EventMemberships, which is the one
    // thing BUILD_SPEC section 4 says a session must never carry. `viaDemo` is the
    // exception that proves it: it can only ever cause a refusal.
    const h = harness()
    await h.run('reviewer')

    const [call] = h.establish.mock.calls as unknown as [[{ subject: SessionSubject }]]
    expect(call[0].subject).toEqual({ kind: 'user', userId: 'fixUser2', viaDemo: true })
  })

  it('looks each persona up under the audience that governs unknown addresses', () => {
    expect(audienceFor('admin')).toBe('admin')
    expect(audienceFor('reviewer')).toBe('admin')
    expect(audienceFor('speaker')).toBe('speaker')
  })

  it('normalizes the configured address before looking it up', async () => {
    const resolve = resolverFor(KNOWN)
    const h = harness({ resolve })
    await signInAsDemoPersona({
      persona: 'admin',
      emails: { ...EMAILS, admin: '  Organizer@Example.com  ' },
      nowMs: 1,
      resolveSubject: resolve,
      establish: h.establish,
      loadMemberships: h.loadMemberships,
      readEvent: h.readEvent,
    })

    expect(resolve).toHaveBeenCalledWith({ email: 'organizer@example.com', audience: 'admin' })
  })
})

describe('demo sign-in destinations', () => {
  it('sends a speaker to the portal without reading memberships', async () => {
    const h = harness()
    expect((await h.run('speaker')).destination).toBe('/portal')
    expect(h.loadMemberships).not.toHaveBeenCalled()
  })

  it('addresses the landing by SLUG, so the whole session keeps readable URLs', async () => {
    // This button produced `/admin/recHnUyjJXap9POSM`, and the admin sidebar builds its links
    // from whatever the URL already carries, so one record id here made every later URL a
    // record id too. `/admin` had already been fixed; this door had not, and it is the door
    // nearly every visitor to the demo uses.
    const h = harness()
    expect((await h.run('admin')).destination).toBe('/admin/fix-event-one')
  })

  it('ranks the liveliest event rather than taking whatever Airtable returned first', async () => {
    // The bug `/admin` was fixed for and this path still had: `memberships.at(0)` is Airtable's
    // order, and landing on a near-empty DRAFT event is how two eval runs concluded the product
    // was empty. The draft is listed first here precisely so ordering cannot be what passes it.
    const h = harness({
      memberships: [
        { ...MEMBERSHIP, id: 'fixMem2', eventId: 'fixEvent2' },
        { ...MEMBERSHIP, eventId: 'fixEvent1' },
      ],
    })

    expect((await h.run('admin')).destination).toBe('/admin/fix-event-one')
  })

  it('falls back to the record id when the event cannot be read', async () => {
    // A membership can outlive its event. Losing the prettier URL is the right cost; losing
    // the landing to an error page is not, and `[eventId]` still resolves a record id.
    const h = harness({ events: new Map() })
    expect((await h.run('admin')).destination).toBe('/admin/fixEvent1')
  })

  it('sends a REVIEWER to their queue, not to the organizer dashboard', async () => {
    // `/admin/{id}` resolves to the `(organizer)` route group, which a reviewer may not
    // read, so landing them there put the "Reviewer access" refusal card in front of them
    // on every single sign-in: their landing page was a notice saying where their landing
    // page was. The role on the membership is what decides it now (`adminLandingPath`).
    const h = harness({ memberships: [{ ...MEMBERSHIP, role: 'reviewer' }] })

    expect((await h.run('reviewer')).destination).toBe('/admin/fix-event-one/evaluation')
  })

  it('refuses an admin with no membership rather than landing them on a 404', async () => {
    const h = harness({ memberships: [] })

    expect(await failureOf(h.run('admin'))).toBe(ErrorIds.AUTH_DEMO_IDENTITY_MISSING)
    // Resolved before the session is written, so the visitor stays signed out on the
    // login page instead of signed in with nowhere to be.
    expect(h.establish).not.toHaveBeenCalled()
  })
})

describe('persona parsing', () => {
  it('accepts the three personas and nothing else', () => {
    expect(isDemoPersona('admin')).toBe(true)
    expect(isDemoPersona('reviewer')).toBe(true)
    expect(isDemoPersona('speaker')).toBe(true)
    expect(isDemoPersona('superuser')).toBe(false)
    expect(isDemoPersona('')).toBe(false)
  })

  it('maps each persona to its own address', () => {
    expect(emailFor('admin', EMAILS)).toBe(EMAILS.admin)
    expect(emailFor('reviewer', EMAILS)).toBe(EMAILS.reviewer)
    expect(emailFor('speaker', EMAILS)).toBe(EMAILS.speaker)
  })
})

describe('the demo mark survives a token round trip', () => {
  // The revocation in session.ts is only as good as the claim reaching the cookie and
  // coming back out of it, so the round trip is asserted rather than assumed.
  async function roundTrip(subject: SessionSubject): Promise<SessionSubject> {
    const token = await mintSessionToken({ subject, nowMs: T0, secret: SECRET })
    return await verifySessionToken({ token, nowMs: T0, secret: SECRET })
  }

  it('carries viaDemo on an admin session', async () => {
    expect(await roundTrip({ kind: 'user', userId: 'recUser1', viaDemo: true })).toEqual({
      kind: 'user',
      userId: 'recUser1',
      viaDemo: true,
    })
  })

  it('carries viaDemo on a speaker session', async () => {
    expect(await roundTrip({ kind: 'speaker', speakerId: 'recSpeaker1', viaDemo: true })).toEqual({
      kind: 'speaker',
      speakerId: 'recSpeaker1',
      viaDemo: true,
    })
  })

  it('leaves an ordinary session unmarked', async () => {
    const subject = await roundTrip({ kind: 'user', userId: 'recUser1' })
    expect(subject).toEqual({ kind: 'user', userId: 'recUser1' })
    expect(subject.viaDemo).toBeUndefined()
  })
})

const PRODUCTION_MINIMUM = {
  DEPLOY_ENV: 'production',
  APP_URL: 'https://bodo.example.com',
  AIRTABLE_TOKEN: 'pat_test',
  AIRTABLE_BASE_ID: 'app_test',
  SESSION_SECRET: 'x'.repeat(32),
  R2_PUBLIC_BASE_URL: 'https://files.bodo.example.com',
  CRON_SECRET: 'cron_test',
}

function messageOf(source: Record<string, string>): string {
  try {
    parseEnv(source)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected parseEnv to reject')
}

describe('DEMO_MODE in the env schema', () => {
  it('is off unless asked for by name', () => {
    expect(parseEnv({}).DEMO_MODE).toBe(false)
    expect(parseEnv({ DEPLOY_ENV: 'local' }).DEMO_MODE).toBe(false)
    expect(parseEnv({ DEMO_MODE: '1' }).DEMO_MODE).toBe(true)
  })

  it('defaults the three addresses to the fixture identities', () => {
    const env = parseEnv({})
    expect(env.DEMO_ADMIN_EMAIL).toBe('organizer@example.com')
    expect(env.DEMO_REVIEWER_EMAIL).toBe('reviewer1@example.com')
    expect(env.DEMO_SPEAKER_EMAIL).toBe('ada@example.com')
  })

  it('lets a production demo deploy with no mailbox', () => {
    // The premise that makes email mandatory in production is that a magic link IS the
    // login. Demo mode is the one configuration where that is false.
    const env = parseEnv({ ...PRODUCTION_MINIMUM, DEMO_MODE: '1' })
    expect(env.DEMO_MODE).toBe(true)
    expect(env.RESEND_API_KEY).toBeUndefined()
  })

  it('still demands a mailbox in production without it', () => {
    const message = messageOf(PRODUCTION_MINIMUM)
    expect(message).toContain('RESEND_API_KEY')
    expect(message).toContain('EMAIL_FROM')
  })

  it('relaxes email and nothing else', () => {
    // The narrowness is the point: a demo that cannot reach its base or sign a cookie
    // is not a demo, so demo mode must not become a way to skip the rest.
    const message = messageOf({ DEPLOY_ENV: 'production', DEMO_MODE: '1' })
    expect(message).toContain('APP_URL')
    expect(message).toContain('AIRTABLE_TOKEN')
    expect(message).toContain('SESSION_SECRET')
    expect(message).toContain('R2_PUBLIC_BASE_URL')
    expect(message).toContain('CRON_SECRET')
    expect(message).not.toContain('RESEND_API_KEY')
  })
})
