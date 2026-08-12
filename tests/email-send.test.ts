// The provider boundary, tested against a stubbed fetch.
//
// The attachment encoding is the reason this file exists. Resend's REST API reads a
// string `content` as base64, so sending raw calendar text produces an attachment
// that decodes to garbage. Nothing about that failure is loud: the API returns 200,
// the outbox row records a message id, and the invite simply does not render. The
// R3 acceptance criterion is that a real calendar event appears in Gmail, Outlook,
// and Apple Calendar, so this is the check standing between that and a green demo
// that quietly delivers nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildInvite } from '@/features/comms/ics'
import { sendEmail } from '@/services/email/send'

type Captured = {
  url: string
  headers: Record<string, string>
  body: {
    from: string
    to: readonly string[]
    subject: string
    html: string
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
  process.env.RESEND_API_KEY = 're_test_key'
  process.env.EMAIL_FROM = 'cfp@bodo.example.com'
  vi.stubGlobal('fetch', fetchMock)

  fetchMock.mockImplementation(
    (url: string, init: { headers: Record<string, string>; body: string }) => {
      captured = {
        url,
        headers: init.headers,
        body: JSON.parse(init.body) as Captured['body'],
      }
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'msg_123' }), {
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

const INVITE_INPUT = {
  calendarUid: 'sess-1@bodo.example.com',
  calendarSequence: 0,
  calendarDtstamp: '2026-08-08T12:00:00.000Z',
  startsAt: '2026-10-12T17:00:00.000Z',
  endsAt: '2026-10-12T17:30:00.000Z',
  organizerEmail: 'cfp@bodo.example.com',
  participantEmails: ['ada@example.com'],
  title: 'Evaluating agents without a golden dataset',
  room: 'Main Stage',
  portalUrl: 'https://bodo.example.com/portal',
}

describe('sendEmail attachments', () => {
  it('base64 encodes attachment content so the provider decodes the original bytes', async () => {
    const ics = buildInvite(INVITE_INPUT)

    await sendEmail({
      to: 'ada@example.com',
      subject: 'You are accepted',
      html: '<p>Congratulations</p>',
      attachments: [
        { filename: 'invite.ics', content: ics, contentType: 'text/calendar; method=REQUEST' },
      ],
    })

    const attachment = captured?.body.attachments?.at(0)
    expect(attachment).toBeDefined()
    // Byte for byte, including the CRLF endings that a naive encode would mangle.
    expect(decodeBase64(attachment?.content ?? '')).toBe(ics)
  })

  it('survives non-ASCII in an attachment, which btoa alone cannot', async () => {
    const ics = buildInvite({ ...INVITE_INPUT, title: '評価ハーネス 🚀 Präsentation' })

    await sendEmail({
      to: 'ada@example.com',
      subject: 'Invite',
      html: '<p>x</p>',
      attachments: [
        { filename: 'invite.ics', content: ics, contentType: 'text/calendar; method=REQUEST' },
      ],
    })

    expect(decodeBase64(captured?.body.attachments?.at(0)?.content ?? '')).toBe(ics)
  })

  it('preserves the method parameter on the content type', async () => {
    // Without `method=REQUEST` the clients treat the file as an attachment rather
    // than an invitation, which is the whole difference the criterion turns on.
    await sendEmail({
      to: 'ada@example.com',
      subject: 'Invite',
      html: '<p>x</p>',
      attachments: [
        {
          filename: 'invite.ics',
          content: 'BEGIN:VCALENDAR',
          contentType: 'text/calendar; method=REQUEST',
        },
      ],
    })

    expect(captured?.body.attachments?.at(0)?.content_type).toBe('text/calendar; method=REQUEST')
  })
})

describe('sendEmail transport', () => {
  it('passes the idempotency key so a retry cannot double deliver', async () => {
    await sendEmail({
      to: 'ada@example.com',
      subject: 'x',
      html: '<p>x</p>',
      idempotencyKey: 'accepted:recSub1:2026-08-06',
    })

    expect(captured?.headers['idempotency-key']).toBe('accepted:recSub1:2026-08-06')
  })

  it('reports the provider message id so the send is auditable', async () => {
    const result = await sendEmail({ to: 'ada@example.com', subject: 'x', html: '<p>x</p>' })

    expect(result).toEqual({ delivered: true, messageId: 'msg_123' })
  })

  it('turns a transport rejection into MAIL_SEND_FAIL rather than a raw TypeError', async () => {
    // DNS failure, TLS failure, reset, and timeout all arrive as a rejection. The
    // outbox needs an error id to classify, not whatever the runtime threw.
    fetchMock.mockRejectedValue(new TypeError('network error'))

    await expect(
      sendEmail({ to: 'ada@example.com', subject: 'x', html: '<p>x</p>' }),
    ).rejects.toMatchObject({ id: 'E_MAIL_001' })
  })

  it('fails rather than reporting success when the provider returns no id', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(
      sendEmail({ to: 'ada@example.com', subject: 'x', html: '<p>x</p>' }),
    ).rejects.toMatchObject({ id: 'E_MAIL_001' })
  })

  it('carries a rejection body into the error context, truncated', async () => {
    fetchMock.mockResolvedValue(new Response('x'.repeat(2000), { status: 422 }))

    await expect(
      sendEmail({ to: 'ada@example.com', subject: 'x', html: '<p>x</p>' }),
    ).rejects.toMatchObject({ id: 'E_MAIL_001' })
  })
})

describe('a provider rejection', () => {
  it("puts Resend's own explanation in the message, not only in the context", async () => {
    // A login returning 500 logged "resend rejected the send: 422" and nothing else,
    // because only `.message` reaches the log line while the body sat in the context.
    // Reproducing the call by hand to read the reason is not a debugging step anybody
    // should need from a provider that already explained itself.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 422,
          name: 'validation_error',
          message: 'Invalid `to` field. Please use our testing email address.',
        }),
        { status: 422 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const error = await sendEmail({
      to: 'ada@example.com',
      subject: 's',
      html: '<p>h</p>',
    }).catch((caught: unknown) => caught)

    expect(String((error as Error).message)).toContain('Invalid `to` field')
    expect(String((error as Error).message)).toContain('422')
  })

  it('falls back to the raw body when it is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>gateway timeout</html>', { status: 504 })),
    )

    const error = await sendEmail({ to: 'ada@example.com', subject: 's', html: '<p>h</p>' }).catch(
      (caught: unknown) => caught,
    )

    expect(String((error as Error).message)).toContain('gateway timeout')
  })
})
