'use server'

// Moving a contact through the sourcing pipeline, from the board or from their profile.
//
// ONE action behind both surfaces, deliberately. The board's Move-to menu and the profile's
// Move-to menu are the same write, and a second copy of it would be a second place for the
// authorization rule and the history rule to be got slightly differently.
//
// AUTHORIZATION IS RECOMPUTED HERE and never taken from the layout or from what the menu
// chose to render, the rule `features/crm/actions.ts` states in its own header: a Server
// Action is reachable by POST whether or not a page ever rendered. Three things are checked,
// and each of them refuses a different attack:
//
//   - `requireCrmScope()` answers which events are the caller's at all.
//   - The contact is resolved out of `listSpeakersInEvents(scope.eventIds)`, so a record id
//     belonging to somebody else's event resolves to nothing. Same read the board just
//     performed, under the same cache entry, so it costs no request.
//   - `editableEventId` then narrows to the events the caller holds `admin` on, and
//     `requireEventRole` re-asks EventMemberships for that one. A reviewer reaches the
//     second check and fails the third, which is why the menu is absent for them: capability
//     comes from EventMemberships, never from a role baked into the session cookie.
//
// The status column being written is `Speakers.status`, the same single select the event
// roster's tab strip filters on. There is deliberately no second, CRM-only stage column: two
// columns meaning "where is this person in the process" is how a board and a roster start
// disagreeing about the same person.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { actingUser } from '@/features/auth/acting-user'
import { requireEventRole } from '@/features/auth/wiring'
import { editableEventId } from '@/features/crm/profile'
import { requireCrmScope } from '@/features/crm/scope'
import { asSpeakerStatus, stageChangeDraft } from '@/features/crm/stage-history'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { saveSpeakerProfile } from '@/services/airtable/mutations-speakers'
import { listSpeakersInEvents } from '@/services/airtable/queries'
import { appendStageChange } from '@/services/airtable/speaker-stage-history'
import type { RecordId } from '@/types/domain'

export type StageMoveResult = {
  /** False when the contact was already on that stage, so nothing was written. */
  readonly moved: boolean
}

export async function setSpeakerStageAction(input: {
  speakerId: RecordId
  /** Client input, narrowed against `SPEAKER_STATUSES` below rather than trusted. */
  status: string
}): Promise<ActionResult<StageMoveResult>> {
  try {
    const scope = await requireCrmScope()

    const to = asSpeakerStatus(input.status)
    if (to === undefined) {
      // Refused rather than coerced, the same call `assertStatus` makes in
      // features/speakers/actions.ts: an unrecognised value written into a single-select
      // column is a 422 that rejects the whole record.
      throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, `"${input.status}" is not a speaker stage`, {
        speakerId: input.speakerId,
      })
    }

    const entry = (await listSpeakersInEvents(scope.eventIds)).find(
      (candidate) => candidate.speaker.id === input.speakerId,
    )
    if (entry === undefined) {
      throw new AppError(
        ErrorIds.DATA_RECORD_NOT_FOUND,
        'that speaker is not on any of your events',
        { speakerId: input.speakerId },
      )
    }

    const eventId = editableEventId(scope, entry.eventIds)
    if (eventId === undefined) {
      throw new AppError(
        ErrorIds.AUTH_FORBIDDEN_ROLE,
        'you can read this contact but not change their stage',
        { speakerId: input.speakerId },
      )
    }
    await requireEventRole(eventId, 'admin')

    const draft = stageChangeDraft({
      speakerId: entry.speaker.id,
      from: entry.speaker.status,
      to,
      // Snapshotted at write time, per the migration note: an organizer removed from the
      // event later must not turn their past moves anonymous.
      authorName: (await actingUser(scope.contextEventId)).name,
      at: new Date().toISOString(),
    })
    // Already there. Not an error: a menu that offers every stage will be clicked on the one
    // the contact is already on, and appending a row saying nothing happened is worse than
    // doing nothing, because an append-only log cannot take it back.
    if (draft === undefined) return actionOk({ moved: false })

    // A PARTIAL draft, and that is `compact`'s contract doing its job rather than an
    // oversight: `speakerFields` drops every `undefined` key, so this writes the status and
    // the address it already had, and cannot blank the biography, the headshot or the
    // logistics that the edit sheet and the speaker's own portal own. `saveSpeakerProfile` is
    // reused rather than a stage-only writer because it is what expires `speaker:{id}`, every
    // linked event's roster AND every linked event's submissions, and a second writer that
    // forgot one of the three would leave a board disagreeing with a roster.
    await saveSpeakerProfile({
      eventId,
      speakerId: entry.speaker.id,
      draft: { email: entry.speaker.email, status: to },
    })

    // AFTER the status, and the order is the one `markSpeakersInvited` argues for: a history
    // row for a move that then failed to land is a log that lies, while a landed move whose
    // history row failed is a log that is merely incomplete, and only the second is something
    // an organizer can see and correct.
    await appendStageChange(draft)

    return actionOk({ moved: true })
  } catch (error) {
    return actionFailure(error)
  }
}
