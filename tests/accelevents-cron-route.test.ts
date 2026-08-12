// The cron URL is public. Authorization must finish before the injected job can
// observe anything, and every failure must remain a response the Worker can log.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorIds } from '@/constants/errorIds'
import { CRON_SECRET_HEADER } from '@/features/jobs/cron-auth'

function requestWith(secret: string): Request {
  return new Request('https://bodo.example.com/api/cron/accelevents', {
    method: 'POST',
    headers: { [CRON_SECRET_HEADER]: secret },
  })
}

beforeEach(() => {
  vi.resetModules()
  process.env.CRON_SECRET = 'cron-secret'
})

describe('Accelevents cron route', () => {
  it('never reaches the job when the request is unauthorized', async () => {
    const { handleAcceleventsCron } = await import('@/app/api/cron/accelevents/route')
    const runJob = vi.fn()

    const response = await handleAcceleventsCron(requestWith('wrong-secret'), runJob)

    // 401, the same answer /api/cron/reminders gives. The two cron endpoints share a
    // header and a secret, so a refused secret must not produce two different statuses.
    // Both were called against the deployed Worker, which is how the mismatch surfaced.
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      id: ErrorIds.AUTH_FORBIDDEN_ROLE,
    })
    expect(runJob).not.toHaveBeenCalled()
  })

  it('returns a JSON error response when the job fails', async () => {
    const { handleAcceleventsCron } = await import('@/app/api/cron/accelevents/route')
    const { AppError } = await import('@/constants/errorIds')
    const runJob = vi
      .fn()
      .mockRejectedValue(new AppError(ErrorIds.ACCEL_UNAVAILABLE, 'Accelevents is unavailable'))

    const response = await handleAcceleventsCron(requestWith('cron-secret'), runJob)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Accelevents is unavailable',
      id: ErrorIds.ACCEL_UNAVAILABLE,
    })
    expect(runJob).toHaveBeenCalledOnce()
  })

  it('returns failed counts with a non-success status so the Worker logs them', async () => {
    const { handleAcceleventsCron } = await import('@/app/api/cron/accelevents/route')
    const counts = { found: 1, retried: 1, succeeded: 0, skipped: 0, failed: 1 }
    const runJob = vi.fn().mockResolvedValue(counts)

    const response = await handleAcceleventsCron(requestWith('cron-secret'), runJob)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual(counts)
  })
})
