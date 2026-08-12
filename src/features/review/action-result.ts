// What a Server Action hands back to a client component.
//
// A Result rather than a throw, for two reasons. A thrown error crossing the action
// boundary reaches the browser as a redacted digest in production, so the reviewer who
// scored an unassigned submission would see "an error occurred" instead of being told
// what happened. And an illegal status transition is an expected outcome of a bulk
// action, not a fault: an admin selecting fifteen rows and pressing Notify should get a
// count of what moved, not a stack trace because two rows were already notified.
//
// This module has no 'use server' directive on purpose. A `'use server'` file may only
// export async functions, so the shared type lives next door.

import { type ErrorId, isAppError } from '@/constants/errorIds'

export type ActionFailure = {
  readonly ok: false
  /** The registry id, so a log line and a UI message trace to the same cause. */
  readonly errorId: ErrorId
  readonly message: string
}

export type ActionResult<TValue> = ({ readonly ok: true } & TValue) | ActionFailure

export function actionOk<TValue extends object>(value: TValue): ActionResult<TValue> {
  return { ok: true, ...value }
}

/**
 * Turns a caught error into a failure the UI can show.
 *
 * An `AppError` carries an id and a message written for a human, so both are passed
 * through. Anything else is a genuine fault: it is re-thrown rather than flattened,
 * because a bug in a mapper should reach the error boundary and the logs, not be
 * reported to an organizer as if their input were at fault.
 */
export function actionFailure(error: unknown): ActionFailure {
  if (isAppError(error)) {
    return { ok: false, errorId: error.id, message: error.message }
  }
  throw error
}
