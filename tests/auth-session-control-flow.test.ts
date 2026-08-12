// The session layer must not swallow Next's control-flow throws.
//
// Next signals "this route is dynamic", "redirect", and "not found" by throwing an
// error carrying a string `digest`. `cookies()` raises `DynamicServerError` during a
// static prerender, which is not a failure at all: it is how the route tells the build
// what it is. Wrapping every throw from `cookies()` in an `AppError` erased that digest
// and made `next build` fail on `/portal/profile` with `E_AUTH_004` rather than marking
// the route dynamic. The build succeeded and the route rendered the moment the signals
// were allowed through, so these tests pin the distinction.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError, ErrorIds, isAppError } from '@/constants/errorIds'

const cookiesMock = vi.hoisted(() => vi.fn())

vi.mock('next/headers', () => ({ cookies: cookiesMock }))

const { currentSubject } = await import('@/features/auth/session')

/** Shaped exactly like the real thing: `next/dist/client/components/hooks-server-context`. */
function dynamicServerError(): Error & { digest: string } {
  const error = new Error('Dynamic server usage: Route used `cookies`.')
  return Object.assign(error, { digest: 'DYNAMIC_SERVER_USAGE' })
}

beforeEach(() => {
  cookiesMock.mockReset()
})

describe('cookieStore control-flow passthrough', () => {
  it('lets DynamicServerError through unchanged, so the build can mark the route dynamic', async () => {
    const thrown = dynamicServerError()
    cookiesMock.mockRejectedValue(thrown)

    // The identity check is the point: a re-wrapped error would still be *an* error,
    // and the build would still fail, which is how this went unnoticed.
    await expect(currentSubject({ nowMs: 0 })).rejects.toBe(thrown)
  })

  it('does not convert a dynamic throw into E_AUTH_004', async () => {
    cookiesMock.mockRejectedValue(dynamicServerError())

    const error = await currentSubject({ nowMs: 0 }).catch((caught: unknown) => caught)

    expect(isAppError(error)).toBe(false)
  })

  // The exact digest strings Next validates, not plausible-looking approximations.
  // `isRedirectError` splits on `;` and checks the type word and the status code, and
  // `isHTTPAccessFallbackError` checks the status is an allowed one. A bare
  // 'NEXT_REDIRECT' is NOT recognised by Next, which is how the first version of this
  // guard came to be looser than the framework it was imitating.
  it.each([
    ['NEXT_REDIRECT;push;/login;307;', 'redirect()'],
    ['NEXT_HTTP_ERROR_FALLBACK;404', 'notFound()'],
  ])('lets the %s digest through, because it is %s and not a failure', async (digest) => {
    const thrown = Object.assign(new Error(digest), { digest })
    cookiesMock.mockRejectedValue(thrown)

    await expect(currentSubject({ nowMs: 0 })).rejects.toBe(thrown)
  })

  it('wraps a digest that only looks like a redirect, matching what Next accepts', async () => {
    // `NEXT_REDIRECT` with no type, destination or status is not a redirect to Next
    // either, so treating it as one would be inventing a signal.
    cookiesMock.mockRejectedValue(Object.assign(new Error('nope'), { digest: 'NEXT_REDIRECT' }))

    const error = await currentSubject({ nowMs: 0 }).catch((caught: unknown) => caught)

    expect(isAppError(error)).toBe(true)
  })

  it('unwraps through `cause`, which is why unstable_rethrow is used over a shape check', async () => {
    const inner = dynamicServerError()
    cookiesMock.mockRejectedValue(new Error('wrapped', { cause: inner }))

    // Next recurses into `cause`, so a signal buried one level down still escapes.
    await expect(currentSubject({ nowMs: 0 })).rejects.toBe(inner)
  })

  it('lets StaticGenBailoutError through, which flags itself on `code` rather than `digest`', async () => {
    const thrown = Object.assign(new Error('bailout'), { code: 'NEXT_STATIC_GEN_BAILOUT' })
    cookiesMock.mockRejectedValue(thrown)

    await expect(currentSubject({ nowMs: 0 })).rejects.toBe(thrown)
  })

  it('still reports a genuinely missing request scope as E_AUTH_004', async () => {
    // The reason the try/catch exists: calling session code outside a request should
    // say so, rather than surfacing whatever Next happens to throw at module scope.
    cookiesMock.mockRejectedValue(new Error('cookies was called outside a request scope'))

    const error = await currentSubject({ nowMs: 0 }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).id).toBe(ErrorIds.AUTH_NO_SESSION)
  })

  it('does not mistake a numeric digest for a control-flow signal', async () => {
    // Application errors carry a numeric `digest` in production React, so the guard
    // matches on `typeof digest === 'string'` rather than on the key being present.
    cookiesMock.mockRejectedValue(Object.assign(new Error('boom'), { digest: 12345 }))

    const error = await currentSubject({ nowMs: 0 }).catch((caught: unknown) => caught)

    expect(isAppError(error)).toBe(true)
  })

  it('reads the session when there is a request scope', async () => {
    // Guards the guard: if the mock never resolves, every test above passes vacuously.
    cookiesMock.mockResolvedValue({ get: () => undefined })

    await expect(currentSubject({ nowMs: 0 })).resolves.toBeUndefined()
  })
})
