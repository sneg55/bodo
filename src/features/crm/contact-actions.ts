'use server'

// Two writes an organizer makes from a contact's CRM profile: leaving an internal note, and
// putting that contact on one of their events.
//
// Both authorize the same way `stage-actions.ts` does and for the same reason (that file's
// header carries the argument): `requireCrmScope()` for which events are the caller's, the
// contact resolved out of `listSpeakersInEvents(scope.eventIds)` so somebody else's record id
// resolves to nothing, and `requireEventRole(eventId, 'admin')` for the capability itself.
//
// Neither of them takes a name, an address or any other profile field from the client. Adding
// a contact to an event is a LINK, not a create: the whole point of the CRM is that the person
// already exists, and re-keying their details on the event side is the duplicate this closes.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { actingUser } from '@/features/auth/acting-user'
import { requireEventRole } from '@/features/auth/wiring'
import { checkNoteBody } from '@/features/crm/notes'
import { editableEventId } from '@/features/crm/profile'
import { type CrmScope, requireCrmScope } from '@/features/crm/scope'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { upsertSpeakerByEmail } from '@/services/airtable/mutations-speakers'
import { listSpeakersInEvents } from '@/services/airtable/queries'
import { appendSpeakerNote } from '@/services/airtable/speaker-notes'
import type { RecordId, Speaker } from '@/types/domain'

/**
 * The contact, or a refusal, resolved through the caller's own scope.
 *
 * The same read the profile and the board just performed, under the same cache entry, so
 * neither action pays a request for its authorization check.
 */
async function scopedContact(
  scope: CrmScope,
  speakerId: RecordId,
): Promise<{ speaker: Speaker; eventIds: readonly RecordId[] }> {
  const entry = (await listSpeakersInEvents(scope.eventIds)).find(
    (candidate) => candidate.speaker.id === speakerId,
  )
  if (entry === undefined) {
    throw new AppError(
      ErrorIds.DATA_RECORD_NOT_FOUND,
      'that speaker is not on any of your events',
      {
        speakerId,
      },
    )
  }
  return entry
}

/**
 * Leave an internal note on a contact. Append only: there is no edit and no delete, which is
 * `speaker-notes.ts`'s design rather than a missing control.
 *
 * A note is ORG level, so the capability checked is "may this caller edit this contact at
 * all" (admin on one of the events they share) rather than anything about a particular event.
 * A reviewer, who may read the CRM, cannot write one: a note is attributed and permanent, and
 * the read capability was never a licence to add to somebody's record forever.
 */
export async function addSpeakerNoteAction(input: {
  speakerId: RecordId
  body: string
}): Promise<ActionResult<{ at: string }>> {
  try {
    const scope = await requireCrmScope()
    const contact = await scopedContact(scope, input.speakerId)

    const eventId = editableEventId(scope, contact.eventIds)
    if (eventId === undefined) {
      throw new AppError(
        ErrorIds.AUTH_FORBIDDEN_ROLE,
        'you can read this contact but not write notes on them',
        { speakerId: input.speakerId },
      )
    }
    await requireEventRole(eventId, 'admin')

    // The same rule the composer counts down against, re-run here because an action is
    // reachable by POST with no textarea ever rendering. The TRIMMED body comes back out of
    // the check, so what was validated is what is written.
    const checked = checkNoteBody(input.body)
    if (!checked.ok) {
      throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, checked.reason, {
        speakerId: input.speakerId,
      })
    }

    const at = new Date().toISOString()
    await appendSpeakerNote({
      speakerId: contact.speaker.id,
      body: checked.body,
      authorName: (await actingUser(scope.contextEventId)).name,
      at,
    })

    return actionOk({ at })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Put an existing contact on one of the caller's events. CRM-10, the outward direction.
 *
 * The inward direction already worked: an event's ADD SPEAKER sheet upserts by email, so
 * adding somebody already in the CRM links the existing record rather than making a second
 * one. What did not exist was the path from the directory OUT to an event, so an organizer
 * looking at a contact they wanted at next year's conference had to leave, open that event's
 * roster, and re-key a name and an address the CRM was already holding.
 *
 * `upsertSpeakerByEmail` is the SAME writer that sheet calls, on purpose. It is what merges
 * the `events` link instead of replacing it ("a returning speaker is on more than one event,
 * and writing only the current event id would drop them from the others"), and what expires
 * `speaker:{id}` plus every affected event's roster. A link written here by hand would have to
 * re-derive both, and getting the merge wrong would silently remove the contact from the
 * events they were already on.
 *
 * The draft carries the ADDRESS AND NOTHING ELSE. `speakerFields` drops every `undefined`
 * key, so this touches the event link and cannot overwrite a name, a biography or a headshot
 * with values the client sent.
 */
export async function addSpeakerToEventAction(input: {
  speakerId: RecordId
  eventId: RecordId
}): Promise<ActionResult<{ eventId: RecordId }>> {
  try {
    const scope = await requireCrmScope()
    const contact = await scopedContact(scope, input.speakerId)

    // The TARGET event is authorized, not one of the contact's existing ones: this write adds
    // a person to a roster, so the capability that matters is `admin` on the roster being
    // added to. `requireEventRole` reads EventMemberships, so an event the caller holds
    // nothing on is refused here whatever `scope` happens to contain.
    await requireEventRole(input.eventId, 'admin')

    if (contact.eventIds.includes(input.eventId)) {
      // Not a write and not an error. The picker already hides the events they are on, so
      // reaching this means the profile was open while somebody else added them.
      return actionOk({ eventId: input.eventId })
    }

    await upsertSpeakerByEmail({ email: contact.speaker.email, eventIds: [input.eventId] })
    return actionOk({ eventId: input.eventId })
  } catch (error) {
    return actionFailure(error)
  }
}
