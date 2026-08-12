// What a dashboard Server Action answers with, and the two helpers every one of them shares.
//
// Its own module rather than the top of actions.ts because that file reached the size the
// file-size hook stops at when widget removal and reordering landed. A plain module and NOT a
// `'use server'` one, deliberately: `failure` and `cut` are called by actions, they are not
// actions themselves, and a `'use server'` file may only export async functions. `ai-actions.ts`
// already imported the type across a module boundary, so nothing about that changes.

import { isAppError } from '@/constants/errorIds'

export type DashboardActionResult =
  /**
   * Where the caller should be standing once the write has landed: a newly created tab, the
   * event home after a delete, or the RENAMED tab, whose slug moved with its name.
   */
  { ok: true; message: string; href?: string } | { ok: false; message: string }

/** A label longer than the column should hold is cut, not refused: it is a label. */
export function cut(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit)
}

/**
 * An `AppError` carries a message written for a human, so it is shown. Anything else is a
 * genuine fault and is re-thrown, so it reaches the error boundary and the logs rather than
 * being reported to an organizer as if their input were at fault.
 */
export function failure(error: unknown): DashboardActionResult {
  if (isAppError(error)) return { ok: false, message: error.message }
  throw error
}
