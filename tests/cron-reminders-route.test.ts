// POST /api/cron/reminders: the public URL the Cron Trigger and the admin "run now"
// button both land on.
//
// Two things are worth testing at this seam and nothing else is. First, that the secret
// is checked BEFORE the job runs, because this endpoint sends the queued mail and an
// unauthenticated caller could otherwise empty the outbox early. Second, that a failure
// comes back as a response rather than an escaping throw: `scheduled()` in
// src/entrypoints/worker.ts logs the status and the body, so an exception that never
// becomes a response is a sweep that failed with no trace in `wrangler tail`.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorIds } from '@/constants/errorIds'
import { CRON_SECRET_HEADER } from '@/features/jobs/cron-auth'

const runRemindersJob = vi.hoisted(() => vi.fn())

vi.mock('@/features/jobs/reminders-wiring', () => ({ runRemindersJob }))

const SECRET = 'correct-horse-battery-staple'

const SWEEP = {
  holder: 'sweep:6f1c',
  reminders: { queued: 2, skipped: 0 },
  // The task-due half of the sweep (SPK-16). Reported alongside the draft half rather than
  // folded into it, because the two read different tables and fail for different reasons.
  taskReminders: { queued: 1, skipped: 0 },
  outbox: { claimed: 2, sent: 2, failed: 0, dead: 0, skipped: 0 },
}

function requestWith(secret?: string): Request {
  const headers = new Headers({ 'x-cron-schedule': '*/5 * * * *' })
  if (secret !== undefined) headers.set(CRON_SECRET_HEADER, secret)
  return new Request('https://bodo.example.com/api/cron/reminders', { method: 'POST', headers })
}

beforeEach(() => {
  // A fresh module graph per test, because `getEnv` caches its parse: without this, the
  // unconfigured-secret case below would leave every later test looking unconfigured too.
  vi.resetModules()
  process.env.CRON_SECRET = SECRET
  runRemindersJob.mockReset()
  runRemindersJob.mockResolvedValue(SWEEP)
})

/**
 * The route and the `AppError` class from the SAME module graph.
 *
 * `isAppError` is an `instanceof` check, so an error built from this file's own import
 * would be an ordinary Error to a route that `vi.resetModules()` has since re-imported,
 * and the test would prove the fallback branch rather than the one it names.
 */
async function freshRoute() {
  const [route, errors] = await Promise.all([
    import('@/app/api/cron/reminders/route'),
    import('@/constants/errorIds'),
  ])
  return { POST: route.POST, AppError: errors.AppError }
}

describe('POST /api/cron/reminders authorization', () => {
  it('refuses a request with no secret and never reaches the job', async () => {
    const { POST } = await freshRoute()

    const response = await POST(requestWith())

    expect(response.status).toBe(401)
    expect(runRemindersJob).not.toHaveBeenCalled()
  })

  it('refuses a wrong secret and never reaches the job', async () => {
    const { POST } = await freshRoute()

    const response = await POST(requestWith('wrong-horse'))

    expect(response.status).toBe(401)
    expect(runRemindersJob).not.toHaveBeenCalled()
  })

  it('refuses every caller when CRON_SECRET is unconfigured', async () => {
    // A forgotten env var must not turn this into a public "send the queued mail now"
    // button.
    delete process.env.CRON_SECRET

    const { POST } = await freshRoute()
    const response = await POST(requestWith(SECRET))

    expect(response.status).toBe(401)
    expect(runRemindersJob).not.toHaveBeenCalled()
  })
})

describe('POST /api/cron/reminders results', () => {
  it('returns the sweep counts as JSON so the scheduled handler can log them', async () => {
    const { POST } = await freshRoute()

    const response = await POST(requestWith(SECRET))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      schedule: '*/5 * * * *',
      reminders: { queued: 2 },
      taskReminders: { queued: 1 },
      outbox: { sent: 2 },
    })
  })

  it('answers a failed TASK enqueue with a non-2xx status too', async () => {
    // The other half of the same rule. A task-due sweep that has stopped filling looks
    // exactly like a roster with nothing outstanding, so the status line is the only thing
    // that can report it.
    runRemindersJob.mockResolvedValue({
      ...SWEEP,
      taskReminders: { queued: 0, skipped: 0, error: `${ErrorIds.DATA_RATE_LIMITED}: 429` },
    })
    const { POST } = await freshRoute()

    const response = await POST(requestWith(SECRET))

    expect(response.ok).toBe(false)
    expect(await response.json()).toMatchObject({ ok: false, reminders: { queued: 2 } })
  })

  it('answers a failed sweep with a JSON body and a non-2xx status', async () => {
    // Not a throw. An unhandled rejection inside `scheduled()` is a sweep that failed
    // with nothing in the log to say why.
    const { POST, AppError } = await freshRoute()
    runRemindersJob.mockRejectedValue(
      new AppError(ErrorIds.DATA_RATE_LIMITED, 'airtable said 429', {}),
    )

    const response = await POST(requestWith(SECRET))

    expect(response.ok).toBe(false)
    expect(await response.json()).toMatchObject({ ok: false, id: ErrorIds.DATA_RATE_LIMITED })
  })

  it('answers a half-failed sweep with a non-2xx status and the counts it did get', async () => {
    // The drain half succeeded and the reminder half did not. Reporting 200 would hide
    // a reminder queue that has silently stopped filling.
    runRemindersJob.mockResolvedValue({
      ...SWEEP,
      reminders: { queued: 0, skipped: 0, error: `${ErrorIds.DATA_RATE_LIMITED}: 429` },
    })
    const { POST } = await freshRoute()

    const response = await POST(requestWith(SECRET))

    expect(response.ok).toBe(false)
    expect(await response.json()).toMatchObject({ ok: false, outbox: { sent: 2 } })
  })

  it('reports a missing Airtable configuration as unavailable rather than a bad request', async () => {
    const { POST, AppError } = await freshRoute()
    runRemindersJob.mockRejectedValue(
      new AppError(ErrorIds.CFG_ENV_MISSING, 'AIRTABLE_TOKEN is unset', {}),
    )

    const response = await POST(requestWith(SECRET))

    expect(response.status).toBe(503)
  })
})
