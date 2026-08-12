// Small, pure helpers for ./actions.ts, split out once that file crossed the size hook's
// limit. Nothing here talks to Airtable or reads the session; every function takes what it
// needs as an argument, which is what makes each one assertable directly rather than only
// reachable through a Server Action.

import { AppError, ErrorIds, isAppError } from '@/constants/errorIds'
import type { PortalTaskItem } from '@/features/portal/ports'
import { parsePostedAnswers } from '@/features/portal/submission-edit'
import type { CompletionInput } from '@/features/portal/task-completion'

/** What a form action hands back to the client component that called it. */
export type ActionResult = { ok: true; message: string } | { ok: false; message: string }

export function required(formData: FormData, name: string): string {
  const value = formData.get(name)
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, `${name} is required`, { name })
  }
  return value.trim()
}

/**
 * A form task's answers arrive as ONE JSON value under `answers`, not as named inputs.
 *
 * They used to arrive as `answer.<fieldId>` entries, one per control, and that limited the
 * control to a text box: a multiselect answer is an array and a checkbox answer is a boolean (see
 * `FieldControl`'s header), and form encoding flattens both into strings that the server's own
 * shape checks then reject. The submission-body edit posts the same way for the same reason, and
 * `parsePostedAnswers` is the shape check both share.
 */
export function completionInput(formData: FormData): CompletionInput {
  const posted = formData.get('answers')
  return {
    fileId: stringOr(formData.get('fileId')),
    confirmed: formData.get('confirmed') === 'on' || formData.get('confirmed') === 'true',
    answers: typeof posted === 'string' ? parsePostedAnswers(posted) : {},
  }
}

/**
 * An upload task's fileId falls back to what `saveTaskUploadAction` already persisted on the
 * assignment, when the posted form carries none. Filed for CNT-02: a page reload discards
 * `TaskCompletion.tsx`'s `useState`, so `Mark complete` can post an empty `fileId` for a task
 * that already has a file attached server-side, and used to be refused for it.
 *
 * Scoped to THIS assignment's own stored answers, never a search across other files or other
 * assignments, so there is nothing to guess: either this exact row already has evidence or it
 * does not, and `buildCompletion` still refuses when it truly does not. Every other kind's
 * submitted input passes through unchanged.
 */
export function withStoredFileFallback(
  item: PortalTaskItem,
  submitted: CompletionInput,
): CompletionInput {
  if (item.task.kind !== 'upload') return submitted
  const posted = submitted.fileId?.trim() ?? ''
  if (posted !== '') return submitted
  return { ...submitted, fileId: storedFileId(item.assignment.answers) }
}

function storedFileId(answers: Record<string, unknown> | undefined): string | undefined {
  const value = answers?.fileId
  return typeof value === 'string' ? value : undefined
}

export function stringOr(value: FormDataEntryValue | null): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function postedStrings(formData: FormData): ReadonlyMap<string, string> {
  const entries = new Map<string, string>()
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') entries.set(key, value)
  }
  return entries
}

/**
 * One place that turns a raised AppError into a message the form can render.
 *
 * Server Actions surface an uncaught error as a generic "an error occurred" in
 * production, which would tell a speaker nothing about a refused save. The id is
 * logged so the cause is greppable, and the message is the AppError's own, which is
 * written for a person in every throw site above.
 */
export async function guarded(
  run: () => Promise<string | { failed: string }>,
): Promise<ActionResult> {
  try {
    const outcome = await run()
    if (typeof outcome === 'string') return { ok: true, message: outcome }
    return { ok: false, message: outcome.failed }
  } catch (error) {
    if (isAppError(error)) {
      console.error(error.toLogLine())
      return { ok: false, message: error.message }
    }
    throw error
  }
}
