'use server'

// Event Settings writes.
//
// It authorizes for itself with `requireEventRole(eventId, 'admin')` rather than relying on
// the layout: a Server Action is reachable by POST without the settings tree ever
// rendering, and this is the surface that renames the public URL of the CFP form and the
// public agenda. BUILD_SPEC section 4.
//
// Failures come back as values rather than thrown. A thrown AppError crossing the action
// boundary reaches the browser as a redacted digest, and "another event already uses that
// slug" is something an organizer can act on once told.
//
// Validation runs here as well as in the form, and not as belt and braces: the client form
// is a convenience and the action is what the record is protected by.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import {
  checkEventDetails,
  hasBlockingProblem,
  type SettingsProblem,
} from '@/features/settings/checks'
import {
  EVENT_TYPE_OPTIONS,
  type EventDetailsDraft,
  toEventDetailsWrite,
} from '@/features/settings/draft'
import { updateEventDetails } from '@/services/airtable/mutations-event'
import type { RecordId } from '@/types/domain'

export type SaveEventDetailsResult = {
  savedAt: string
  /** The slug as stored, so the form can adopt the trimmed and lowercased value. */
  slug: string
}

export async function saveEventDetailsAction(input: {
  eventId: RecordId
  draft: EventDetailsDraft
}): Promise<ActionResult<SaveEventDetailsResult>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const problems = checkEventDetails(input.draft)
    if (hasBlockingProblem(problems)) throw refusal(problems, input.eventId)

    // Checked separately from `checkEventDetails`, which is pure over the draft and has no
    // business knowing the base's select vocabulary. Airtable answers an unknown option
    // with a 422, so this turns that into a sentence.
    if (!EVENT_TYPE_OPTIONS.includes(input.draft.eventType)) {
      throw new AppError(
        ErrorIds.DATA_WRITE_FAIL,
        `${input.draft.eventType} is not one of the event types this base accepts.`,
        { eventId: input.eventId },
      )
    }

    const write = toEventDetailsWrite(input.draft)
    const saved = await updateEventDetails({ eventId: input.eventId, write })

    return actionOk({ savedAt: new Date().toISOString(), slug: saved.slug })
  } catch (error) {
    return actionFailure(error)
  }
}

function refusal(problems: readonly SettingsProblem[], eventId: RecordId): AppError {
  return new AppError(
    ErrorIds.DATA_WRITE_FAIL,
    problems.map((problem) => problem.message).join(' '),
    { eventId },
  )
}
