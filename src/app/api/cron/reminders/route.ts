// POST /api/cron/reminders: queue the due draft reminders, then send what is queued.
//
// The Cron Trigger reaches this through `scheduled()` in src/entrypoints/worker.ts, which
// calls the Next handler in-process with the shared secret in a header; the admin "run
// now" button will POST the same secret to the same URL. BUILD_SPEC 5.3 asks for exactly
// that, so there is one auth path and no special case for the scheduler.
//
// Two rules this file exists to keep:
//
//   1. `assertCronAuthorized` runs FIRST. This endpoint sends mail, so an unauthorized
//      caller who reached the job could empty the outbox ahead of schedule.
//   2. Nothing throws out of here. `scheduled()` logs the status and the body when the
//      response is not ok, so a failure that escapes as an exception is a sweep that
//      failed with nothing in `wrangler tail` to say why. A half-failed sweep (the drain
//      worked, the enqueue did not) is also non-2xx, because a reminder queue that has
//      silently stopped filling looks exactly like a quiet week.
//
// The logic is in `@/features/jobs/reminders` and its wiring, not here: `src/app/**` wires
// and nothing else, and the sweep has to stay testable from neither entry point.

import { ErrorIds, isAppError } from '@/constants/errorIds'
import { assertCronAuthorized } from '@/features/jobs/cron-auth'
import { runRemindersJob } from '@/features/jobs/reminders-wiring'

export async function POST(request: Request): Promise<Response> {
  try {
    assertCronAuthorized(request)

    const sweep = await runRemindersJob(eventIdOf(request))
    // Both enqueue halves count. A task-due sweep that has silently stopped filling looks
    // exactly like a roster with nothing outstanding, which is rule 2 in the header applied
    // to the second queue: it is reported rather than thrown, so the status line is the only
    // thing that can say it failed.
    const ok = sweep.reminders.error === undefined && sweep.taskReminders.error === undefined

    return Response.json(
      {
        ok,
        // Echoed back so a log line names the schedule that produced it. Absent for the
        // admin button, which is the other caller.
        schedule: request.headers.get('x-cron-schedule') ?? 'manual',
        ...sweep,
      },
      { status: ok ? 200 : 500 },
    )
  } catch (error) {
    if (isAppError(error)) {
      console.error(error.toLogLine())
      return Response.json(
        { ok: false, error: error.message, id: error.id },
        { status: statusFor(error.id) },
      )
    }
    // Still a response, and still carries something to grep for. An unknown throw here
    // would otherwise reach the runtime as an unhandled rejection inside `scheduled()`.
    console.error('[cron] reminders sweep failed with a non-AppError', error)
    return Response.json({ ok: false, error: 'the reminder sweep failed' }, { status: 500 })
  }
}

/** The admin "run now" button will name an event. A Cron Trigger carries no parameters. */
function eventIdOf(request: Request): { eventId?: string } {
  const value = new URL(request.url).searchParams.get('eventId')?.trim()
  return value === undefined || value === '' ? {} : { eventId: value }
}

function statusFor(id: string): number {
  // A refused secret is 401 and not 403: the caller presented no usable credential, and
  // the two cron callers both authenticate with the same header.
  if (id === ErrorIds.AUTH_FORBIDDEN_ROLE) return 401
  // Unconfigured rather than broken: no Airtable base, no claim guard binding, no
  // PORTAL_EVENT_ID. Retrying without a deploy change will not help, and 503 says so.
  if (
    id === ErrorIds.CFG_ENV_MISSING ||
    id === ErrorIds.CFG_BINDING_MISSING ||
    id === ErrorIds.CFG_BINDING_FAILED
  ) {
    return 503
  }
  return 500
}
