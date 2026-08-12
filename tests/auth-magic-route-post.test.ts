// POST /api/auth/magic, which is the front door of the whole product.
//
// A magic link IS the login (BUILD_SPEC 4), and this is a plain `<form method="post">` so
// that signing in works with scripting off. Both of those facts had consequences the route
// was not honouring:
//
//   1. A browser NAVIGATES to whatever a plain form post returns, so answering with
//      `Response.json({ ok: true })` rendered that JSON as the page.
//   2. `sendEmail` returns `delivered: false` when no provider is configured, and the
//      route discarded it and answered ok anyway. On the deployed Worker, with no
//      RESEND_API_KEY set, that meant every visitor was told "check your email" and no
//      email existed. Verified against the deployment before the fix: the endpoint
//      returned `{"ok":true}` with nothing sent.
//
// The login page already read `sent` and `error` from its query string, so only the
// redirect was ever missing.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError, ErrorIds } from '@/constants/errorIds'

const mocks = vi.hoisted(() => ({
  requestMagicLink: vi.fn(),
  resolveLoginSubject: vi.fn(),
  sendEmail: vi.fn(),
}))

vi.mock('@/features/auth/magic-link', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/auth/magic-link')>()
  return { ...actual, requestMagicLink: mocks.requestMagicLink }
})
vi.mock('@/features/auth/resolve-subject', () => ({
  resolveLoginSubject: mocks.resolveLoginSubject,
}))
vi.mock('@/services/email/send', () => ({ sendEmail: mocks.sendEmail }))
const hasEmailMock = vi.hoisted(() => vi.fn(() => true))
// Defaults to false, so every existing case below keeps describing a DEPLOYMENT.
// The local-machine branch is opted into explicitly, in its own describe.
const isLocalDeployMock = vi.hoisted(() => vi.fn(() => false))
vi.mock('@/utils/env', () => ({
  appUrl: () => 'https://bodo.example',
  hasEmail: hasEmailMock,
  isLocalDeploy: isLocalDeployMock,
}))

const { POST } = await import('@/app/api/auth/magic/route')

function post(fields: Record<string, string>): Request {
  const body = new URLSearchParams(fields)
  return new Request('https://bodo.example/api/auth/magic', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

/** The `location` header's query string, which is the whole observable outcome. */
function target(response: Response): URLSearchParams {
  const location = response.headers.get('location') ?? ''
  return new URLSearchParams(location.slice(location.indexOf('?') + 1))
}

beforeEach(() => {
  hasEmailMock.mockReturnValue(true)
  isLocalDeployMock.mockReturnValue(false)
  mocks.requestMagicLink.mockReset()
  mocks.requestMagicLink.mockResolvedValue({ delivered: true, url: 'x', jti: 'j', expiresAtMs: 0 })
})

describe('a link that was sent', () => {
  it('redirects back to the form rather than rendering JSON at the visitor', async () => {
    const response = await POST(post({ email: 'ada@example.com' }) as never)

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toContain('/login?')
    expect(target(response).get('sent')).toBe('1')
  })

  it('uses 303 and not 302, so a reload cannot mint a second link', async () => {
    // 302 leaves the browser free to repeat the POST on refresh.
    const response = await POST(post({ email: 'ada@example.com' }) as never)

    expect(response.status).toBe(303)
  })

  it('carries `next` and `audience` through, so a refusal does not lose them', async () => {
    const response = await POST(
      post({ email: 'ada@example.com', next: '/portal/tasks', audience: 'admin' }) as never,
    )

    const params = target(response)
    expect(params.get('next')).toBe('/portal/tasks')
    expect(params.get('audience')).toBe('admin')
  })
})

describe('an address with no account', () => {
  it('gets the identical answer, so the form is not an account enumerator', async () => {
    mocks.requestMagicLink.mockRejectedValue(
      new AppError(ErrorIds.AUTH_UNKNOWN_ADMIN, 'no account for this email', {}),
    )

    const response = await POST(post({ email: 'nobody@example.com' }) as never)

    expect(response.status).toBe(303)
    expect(target(response).get('sent')).toBe('1')
    expect(target(response).get('error')).toBeNull()
  })
})

describe('a deployment with no email provider', () => {
  it('says so instead of claiming the link is on its way', async () => {
    // Silence here is indistinguishable from success to the visitor, and there is no
    // second channel to sign in through.
    hasEmailMock.mockReturnValue(false)

    const response = await POST(post({ email: 'ada@example.com' }) as never)

    expect(target(response).get('error')).toBe('undeliverable')
    expect(target(response).get('sent')).toBeNull()
  })

  it('answers before resolving the address, so it is not an existence oracle', async () => {
    // This is the ordering that matters and it was wrong at first. Asking the provider and
    // reporting `delivered: false` afterwards meant a KNOWN address got `undeliverable`
    // while an unknown one threw earlier and got `sent=1`, which is exactly the
    // distinction section 4 forbids. The check is a fact about the deployment, so it has to
    // happen before any lookup.
    hasEmailMock.mockReturnValue(false)

    const response = await POST(post({ email: 'nobody@nowhere.test' }) as never)

    expect(target(response).get('error')).toBe('undeliverable')
    expect(mocks.requestMagicLink).not.toHaveBeenCalled()
  })

  it('reports the fault without naming the address, so it stays safe on a public page', async () => {
    hasEmailMock.mockReturnValue(false)

    const response = await POST(post({ email: 'ada@example.com' }) as never)

    expect(response.headers.get('location')).not.toContain('ada@example.com')
  })
})

describe('a developer machine with no email provider', () => {
  // The deployment behaviour above is right for a deployment and wrong for a laptop:
  // it left a fresh clone with no way to sign in at all, because the only channel the
  // link could arrive on was the one that was not configured. Locally there IS a
  // second channel, the server's own log, so the route mints the link and prints it.
  beforeEach(() => {
    hasEmailMock.mockReturnValue(false)
    isLocalDeployMock.mockReturnValue(true)
    mocks.requestMagicLink.mockResolvedValue({
      delivered: false,
      url: 'https://bodo.example/api/auth/magic?token=tok',
      jti: 'j',
      expiresAtMs: 0,
    })
  })

  it('mints the link instead of dead-ending', async () => {
    const response = await POST(post({ email: 'ada@example.com' }) as never)

    expect(mocks.requestMagicLink).toHaveBeenCalled()
    expect(target(response).get('sent')).toBe('1')
    expect(target(response).get('error')).toBeNull()
  })

  it('prints the link to the server log, which is the only place it can arrive', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* captured below */
    })

    await POST(post({ email: 'ada@example.com' }) as never)

    expect(warn.mock.calls.flat().join(' ')).toContain(
      'https://bodo.example/api/auth/magic?token=tok',
    )
    warn.mockRestore()
  })

  it('still answers identically for an unknown address, so it is not an existence oracle', async () => {
    // The relaxed check must not reintroduce the distinction section 4 forbids. An
    // unknown address throws before a link exists and is caught, so both answers are
    // `sent=1` and neither leaks whether the account is real.
    mocks.requestMagicLink.mockRejectedValue(
      new AppError(ErrorIds.AUTH_UNKNOWN_ADMIN, 'no account for this email'),
    )

    const response = await POST(post({ email: 'nobody@nowhere.test' }) as never)

    expect(target(response).get('sent')).toBe('1')
    expect(target(response).get('error')).toBeNull()
  })

  it('prints nothing when the provider really did take the message', async () => {
    // Gated on `delivered`, not on the deploy kind, so a developer who HAS configured
    // Resend does not get a working link echoed into their terminal.
    hasEmailMock.mockReturnValue(true)
    mocks.requestMagicLink.mockResolvedValue({
      delivered: true,
      url: 'https://bodo.example/api/auth/magic?token=tok',
      jti: 'j',
      expiresAtMs: 0,
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* captured below */
    })

    await POST(post({ email: 'ada@example.com' }) as never)

    expect(warn.mock.calls.flat().join(' ')).not.toContain('token=tok')
    warn.mockRestore()
  })
})

describe('an empty submission', () => {
  it('returns to the form with something actionable and never mints a link', async () => {
    const response = await POST(post({ email: '   ' }) as never)

    expect(target(response).get('error')).toBe('missing_email')
    expect(mocks.requestMagicLink).not.toHaveBeenCalled()
  })
})

describe('a recipient the provider refuses', () => {
  it('is not a crash, because a seeded example.com speaker hits it every time', async () => {
    // Resend rejects that domain by name. An unhandled throw turned an ordinary login
    // attempt into a 500, which is what the deployed Worker actually returned.
    mocks.requestMagicLink.mockRejectedValue(
      new AppError(ErrorIds.MAIL_SEND_FAIL, 'resend rejected the send: 422 Invalid `to` field', {}),
    )

    const response = await POST(post({ email: 'ada@example.com' }) as never)

    expect(response.status).toBe(303)
  })

  it('answers exactly as a sent link does, so the form still hides which accounts exist', async () => {
    // The deliberate tradeoff: a distinct answer would help the visitor and would also
    // reveal the address is registered, since an unregistered one never reaches the
    // provider. Section 4 chooses the constant answer; the operator gets the log.
    mocks.requestMagicLink.mockRejectedValue(
      new AppError(ErrorIds.MAIL_SEND_FAIL, 'resend rejected the send: 422', {}),
    )

    const response = await POST(post({ email: 'ada@example.com' }) as never)

    expect(target(response).get('sent')).toBe('1')
    expect(target(response).get('error')).toBeNull()
  })

  it('still rethrows a fault that is not a send failure', async () => {
    // A broken mapper or a bad secret must reach the error boundary and the logs rather
    // than being flattened into "check your email".
    mocks.requestMagicLink.mockRejectedValue(new Error('boom'))

    await expect(POST(post({ email: 'ada@example.com' }) as never)).rejects.toThrow('boom')
  })
})
