'use server'

// Moving one speaker along the organizer's own process, from the roster row itself.
//
// The roster has always DRAWN the speaker status as a chip, and for a long time that chip was
// the only thing on the row that looked like a control and was not one. An eval run filed it
// as a dead control on exactly that reading, and it was right to: the only way to change a
// status was to open the edit sheet, find the select among ten fields, and press Save. A
// pill that reads `Prospect` beside a tab strip called Prospect / Confirmed is a thing people
// press.
//
// ONE COLUMN, and that is why this is not `saveSpeakerProfileAction` with the row's values
// filled in. That action takes the whole editable profile, so calling it from a menu would
// mean the menu re-posting a biography it never showed and a headshot URL it never read, and
// any drift between the roster's copy of a field and the record's would be written back as an
// edit. The draft here names `email` (the identity `speakerFields` always writes) and
// `status`, and `compact` drops every other column without touching it.
//
// It authorizes for itself and resolves the speaker against the AUTHORIZED event's roster,
// exactly as the profile edit does: a speaker id is client input, and without that check an
// admin of one event could move another event's speaker by posting their record id.

import { requireEventRole } from '@/features/auth/wiring'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { assertSpeakerStatus } from '@/features/speakers/add-speaker-draft'
import { resolveEventSpeaker } from '@/features/speakers/resolve-speaker'
import { saveSpeakerProfile } from '@/services/airtable/mutations-speakers'
import type { RecordId } from '@/types/domain'

export async function setSpeakerStatusAction(input: {
  eventId: RecordId
  speakerId: RecordId
  /** Client input, checked against the closed vocabulary. */
  status: string
}): Promise<ActionResult<{ speakerId: RecordId; moved: boolean }>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const speaker = await resolveEventSpeaker(input.eventId, input.speakerId)
    const status = assertSpeakerStatus(input.status, input.speakerId)

    // Choosing the status somebody already holds writes nothing and says so, rather than
    // reporting a save that changed no column. Same reading as the CRM's stage menu.
    if (speaker.status === status) {
      return actionOk({ speakerId: speaker.id, moved: false })
    }

    await saveSpeakerProfile({
      eventId: input.eventId,
      speakerId: speaker.id,
      draft: { email: speaker.email, status },
    })

    return actionOk({ speakerId: speaker.id, moved: true })
  } catch (error) {
    return actionFailure(error)
  }
}
