'use server'

// Invite a speaker to the portal. SPK-06.
//
// The gap this closes: the roster was a list an organizer could read and edit but never
// write to. Every route into the speaker portal ran through a submission decision, so a
// person imported from a spreadsheet, or added by hand, or accepted last year, had no way of
// being told the portal existed. `requestMagicLink` was the only outbound message the admin
// side could send a person, and its only admin caller invites TEAM members.
//
// It queues rather than sends, like every other trigger (BUILD_SPEC 5.3), so inviting forty
// speakers is one Airtable write rather than forty provider calls an organizer waits on.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { TEMPLATE_KEYS } from '@/features/comms/template-keys'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { inviteOutboxRows } from '@/features/speakers/invite-outbox'
import { enqueueEmails } from '@/services/airtable/mutations-outbox'
import { markSpeakersInvited } from '@/services/airtable/mutations-speakers'
import { getEvent, listSpeakers } from '@/services/airtable/queries'
import { findEmailTemplate } from '@/services/airtable/reads-comms'
import type { RecordId } from '@/types/domain'
import { appUrl } from '@/utils/env'

export type InviteResult = {
  /** How many messages were newly queued. Zero means every one was already sent. */
  readonly queued: number
  /** Speakers that were asked for but have no email address on file. */
  readonly skipped: number
  /** The instant stamped on the invited rows, so the caller can patch its list. */
  readonly invitedAt: string
}

/**
 * Queue the portal invitation for one speaker or a selection of them.
 *
 * The ids are client input, so they are resolved against the AUTHORIZED event's own roster
 * before anything is written: without that, an admin of one event could mail another event's
 * speakers by posting their record ids. The same rule `saveSpeakerProfileAction` follows.
 *
 * The roster read is the CACHED one, and that is a considered choice rather than an
 * oversight. It supplies two things: which ids are on this event, which changes rarely, and
 * each speaker's stored `invitedAt`, which is the key epoch. A stale epoch computes the key
 * a previous invite already used, so `enqueueEmails` drops the row and nothing is sent
 * twice. The failure direction is a second press that queues nothing, which the returned
 * count makes visible, rather than a duplicate mail nobody can recall.
 */
export async function inviteSpeakersAction(input: {
  eventId: RecordId
  speakerIds: readonly RecordId[]
}): Promise<ActionResult<InviteResult>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const roster = await listSpeakers(input.eventId)
    const wanted = new Set(input.speakerIds)
    const chosen = roster.filter((speaker) => wanted.has(speaker.id))

    if (chosen.length === 0) {
      throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'no speaker on this event matched', {
        eventId: input.eventId,
      })
    }

    const event = await getEvent(input.eventId)
    const invitedAt = new Date().toISOString()

    const rows = inviteOutboxRows({
      eventId: input.eventId,
      eventName: event.name,
      eventSlug: event.slug,
      recipients: chosen.map((speaker) => ({
        speakerId: speaker.id,
        email: speaker.email,
        firstName: speaker.firstName,
        lastName: speaker.lastName,
        invitedAt: speaker.invitedAt,
      })),
      invitedAt,
      portalUrl: `${appUrl()}/portal`,
      template: await findEmailTemplate(input.eventId, TEMPLATE_KEYS.speakerInvite),
    })

    const { queued } = await enqueueEmails(rows, 'action')

    // Only the people a row was actually built for. Stamping somebody with no address would
    // make the roster claim they had been written to.
    await markSpeakersInvited({
      eventId: input.eventId,
      speakerIds: rows.map((row) => row.speakerId).filter((id) => id !== undefined),
      invitedAt,
    })

    return actionOk({ queued, skipped: chosen.length - rows.length, invitedAt })
  } catch (error) {
    return actionFailure(error)
  }
}
