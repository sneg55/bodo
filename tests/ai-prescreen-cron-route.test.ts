// /api/cron/prescreen is a public URL. Authorization must finish before the injected job
// can observe anything, and every failure must stay a response the Worker can log.
//
// The status codes are asserted against the Accelevents route's, not chosen freshly: both
// cron endpoints share a header and a secret, and two of them answering a refused secret
// differently is a difference somebody has to debug on the deployed Worker first.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorIds } from '@/constants/errorIds'
import { CRON_SECRET_HEADER } from '@/features/jobs/cron-auth'

function requestWith(secret: string): Request {
  return new Request('https://bodo.example.com/api/cron/prescreen', {
    method: 'POST',
    headers: { [CRON_SECRET_HEADER]: secret },
  })
}

beforeEach(() => {
  vi.resetModules()
  process.env.CRON_SECRET = 'cron-secret'
})

describe('pre-screen cron route', () => {
  it('never reaches the job when the request is unauthorized', async () => {
    const { handlePrescreenCron } = await import('@/app/api/cron/prescreen/route')
    const runJob = vi.fn()

    const response = await handlePrescreenCron(requestWith('wrong-secret'), runJob)

    expect(response.status).toBe(401)
    expect(runJob).not.toHaveBeenCalled()
  })

  it('answers 503 when the ai@system reviewer has not been seeded', async () => {
    const { handlePrescreenCron } = await import('@/app/api/cron/prescreen/route')
    // Imported AFTER `vi.resetModules()`, so the class the route's `isAppError` checks
    // against is the one this error was built from. A top-level import here is a second
    // module instance and the route reports it as an unknown fault.
    const { AppError } = await import('@/constants/errorIds')
    // Not a 500: the deployment cannot pre-screen at all until the row exists, which is a
    // configuration state rather than a fault in this request.
    const runJob = vi
      .fn()
      .mockRejectedValue(new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'no AdminUsers row'))

    const response = await handlePrescreenCron(requestWith('cron-secret'), runJob)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      id: ErrorIds.DATA_RECORD_NOT_FOUND,
    })
  })

  it('returns counts, and only a real failure is a non-success status', async () => {
    const { handlePrescreenCron } = await import('@/app/api/cron/prescreen/route')
    const contended = { found: 3, scored: 0, failed: 0, contended: 3 }

    // A contended tick means another tick holds the lease, which is the guard working.
    const quiet = await handlePrescreenCron(
      requestWith('cron-secret'),
      vi.fn().mockResolvedValue(contended),
    )
    expect(quiet.status).toBe(200)

    const loud = await handlePrescreenCron(
      requestWith('cron-secret'),
      vi.fn().mockResolvedValue({ ...contended, failed: 1 }),
    )
    expect(loud.status).toBe(502)
    await expect(loud.json()).resolves.toMatchObject({ failed: 1 })
  })
})
