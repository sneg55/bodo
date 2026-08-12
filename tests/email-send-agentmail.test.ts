// The AgentMail adapter, against a stubbed fetch.
//
// Separate from email-send.test.ts because the env boundary caches on first read, so a
// file cannot exercise two providers. Everything here is a difference from Resend that
// would fail silently: the sender lives in the URL rather than the body, and the
// idempotency key has an alphabet that every key this app mints violates.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildInvite } from '@/features/comms/ics'
import { sendEmail } from '@/services/email/send'

type Captured = {
  url: string
  headers: Record<string, string>
  body: {
    to: readonly string[]
    subject: string
    html: string
    reply_to?: readonly string[]
    attachments?: readonly { filename: string; content: string; content_type: string }[]
  }
}

let captured: Captured | undefined
const fetchMock = vi.fn()

function decodeBase64(value: string): string {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

beforeEach(() => {
  captured = undefined
  fetchMock.mockReset()
  // The env boundary caches, so these have to be present before the first read.
  //
  // `EMAIL_PROVIDER` goes through Object.assign because `worker-configuration.d.ts` is
  // GENERATED from the vars in wrangler.jsonc and narrows it to the literal `"resend"`
  // that is set there. The schema in env-schema.ts is the real contract; regenerating the
  // Cloudflare types to widen a test assignment would be the tail wagging the dog.
  Object.assign(process.env, { EMAIL_PROVIDER: 'agentmail' })
  process.env.AGENTMAIL_API_KEY = 'am_test_key'
  // With a display name, because that is a legal EMAIL_FROM and the inbox id is not.
  process.env.EMAIL_FROM = 'bodo CFP <lazyfamily48@agentmail.to>'
  vi.stubGlobal('fetch', fetchMock)

  fetchMock.mockImplementation(
    (url: string, init: { headers: Record<string, string>; body: string }) => {
      captured = {
        url,
        headers: init.headers,
        body: JSON.parse(init.body) as Captured['body'],
      }
      return Promise.resolve(
        new Response(JSON.stringify({ message_id: 'msg_abc', thread_id: 'thr_abc' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the agentmail adapter addresses the sending inbox', () => {
  it('sends from the address in EMAIL_FROM, with any display name stripped', async () => {
    await sendEmail({ to: 'ada@example.com', subject: 'x', html: '<p>x</p>' })

    // The sender is the inbox in the PATH. A `from` in the body would be ignored, so
    // getting this wrong sends as the wrong mailbox rather than failing.
    expect(captured?.url).toBe(
      'https://api.agentmail.to/v0/inboxes/lazyfamily48%40agentmail.to/messages/send',
    )
  })

  it('authenticates with the AgentMail key, not the Resend one', async () => {
    process.env.RESEND_API_KEY = 're_should_not_be_used'

    await sendEmail({ to: 'ada@example.com', subject: 'x', html: '<p>x</p>' })

    expect(captured?.headers.authorization).toBe('Bearer am_test_key')
  })

  it('sends reply_to as a list, which is the shape this API takes', async () => {
    await sendEmail({
      to: 'ada@example.com',
      subject: 'x',
      html: '<p>x</p>',
      replyTo: 'cfp@bodo.example.com',
    })

    expect(captured?.body.reply_to).toEqual(['cfp@bodo.example.com'])
  })
})

describe('the agentmail idempotency key', () => {
  it('hashes the caller key into the alphabet the API accepts', async () => {
    // AgentMail allows 1-256 characters of A-Za-z0-9-._~ and answers 400 otherwise.
    // Every key in triggers.ts contains `:`, and the admin alert's contains `@`.
    await sendEmail({
      to: 'ada@example.com',
      subject: 'x',
      html: '<p>x</p>',
      idempotencyKey: 'accepted:recSub1:2026-08-06T00:00:00.000Z:recSpk2',
    })

    // Pinned to the digest, computed independently with shasum, so this fails if the
    // derivation ever changes and starts letting retries through as fresh sends.
    expect(captured?.headers['idempotency-key']).toBe(
      '57d991554bdcba985dc3fcf8de068efd5f9e1aecd7381e31101abcaf95af4a49',
    )
  })

  it('derives a different key for a different message', async () => {
    // Substituting the offending characters rather than hashing would collapse
    // `a:b` and `a.b` onto one key, and a collision does not double-send: it makes the
    // second, different message vanish with a 200 and the first one's id.
    await sendEmail({
      to: 'ada@example.com',
      subject: 'x',
      html: '<p>x</p>',
      idempotencyKey: 'accepted:recSub1:2026-08-06T00:00:00.000Z:recSpk2',
    })
    const first = captured?.headers['idempotency-key']

    await sendEmail({
      to: 'ada@example.com',
      subject: 'x',
      html: '<p>x</p>',
      idempotencyKey: 'accepted.recSub1.2026-08-06T00:00:00.000Z.recSpk2',
    })

    expect(captured?.headers['idempotency-key']).not.toBe(first)
  })

  it('sends no key at all when the caller minted none', async () => {
    await sendEmail({ to: 'ada@example.com', subject: 'x', html: '<p>x</p>' })

    // An empty Idempotency-Key header is a 400, so absent has to mean absent.
    expect(captured?.headers['idempotency-key']).toBeUndefined()
  })
})

describe('the agentmail adapter and attachments', () => {
  it('base64 encodes the calendar body byte for byte, non-ASCII included', async () => {
    const ics = buildInvite({
      calendarUid: 'sess-1@bodo.example.com',
      calendarSequence: 0,
      calendarDtstamp: '2026-08-08T12:00:00.000Z',
      startsAt: '2026-10-12T17:00:00.000Z',
      endsAt: '2026-10-12T17:30:00.000Z',
      organizerEmail: 'cfp@bodo.example.com',
      participantEmails: ['ada@example.com'],
      title: '評価ハーネス 🚀 Präsentation',
      room: 'Main Stage',
      portalUrl: 'https://bodo.example.com/portal',
    })

    await sendEmail({
      to: 'ada@example.com',
      subject: 'You are accepted',
      html: '<p>Congratulations</p>',
      attachments: [
        { filename: 'invite.ics', content: ics, contentType: 'text/calendar; method=REQUEST' },
      ],
    })

    const attachment = captured?.body.attachments?.at(0)
    expect(decodeBase64(attachment?.content ?? '')).toBe(ics)
    // Without `method=REQUEST` the clients render a file rather than an invitation.
    expect(attachment?.content_type).toBe('text/calendar; method=REQUEST')
  })
})

describe('the agentmail adapter on failure', () => {
  it('reports the provider message id so the send is auditable', async () => {
    const result = await sendEmail({ to: 'ada@example.com', subject: 'x', html: '<p>x</p>' })

    expect(result).toEqual({ delivered: true, messageId: 'msg_abc' })
  })

  it('fails rather than reporting success when the response carries no message id', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ thread_id: 'thr_abc' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(
      sendEmail({ to: 'ada@example.com', subject: 'x', html: '<p>x</p>' }),
    ).rejects.toMatchObject({ id: 'E_MAIL_001' })
  })

  it("puts AgentMail's own explanation in the message", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Inbox not found' }), { status: 404 }),
    )

    const error = await sendEmail({ to: 'ada@example.com', subject: 'x', html: '<p>x</p>' }).catch(
      (caught: unknown) => caught,
    )

    expect(String((error as Error).message)).toContain('Inbox not found')
    expect(String((error as Error).message)).toContain('404')
  })
})
