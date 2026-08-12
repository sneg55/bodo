'use server'

// Creating one CRM contact by hand.
//
// THE GAP THIS CLOSES. Every contact in the CRM arrived from a CFP submission or from the CSV
// import, so adding a single speaker somebody met at a conference meant writing a one-row
// spreadsheet and walking it through a four-step wizard. There was no create action anywhere
// to hang a button on: `contact-actions.ts` links an existing contact to an event and appends
// a note, and neither makes a person.
//
// WHY IT IS NOT `addSpeakerAction`. `features/speakers/actions.ts` already creates a speaker,
// and it opens with `requireEventRole(input.eventId, 'admin')` on an event id the caller
// supplies: it is a roster write on ONE event's Speakers page, and it belongs there. The CRM
// is org-scoped and has no event in its path, so the authorization has to be established the
// way every other CRM write establishes it, and that is what this file does:
//
//   - `requireCrmScope()` answers which events are the caller's at all. A signed-in user with
//     no membership anywhere is refused here, before any input is looked at.
//   - The chosen event must be one the caller holds `admin` on, checked against
//     `scope.adminEventIds` and then re-asked of EventMemberships by `requireEventRole`. The
//     first check is what makes the refusal say something useful; the second is the boundary,
//     because capability comes from EventMemberships and never from the session cookie
//     (BUILD_SPEC section 4). A reviewer fails both.
//   - Nothing about the contact is taken on trust: `checkNewContact` trims and bounds every
//     field, and only the five it hands back are written.
//
// It is a Server Action, so it is reachable by POST whether or not the dialog ever rendered.
// That is exactly why the checks are here rather than in the layout above it.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import {
  checkNewContact,
  contactDisplayName,
  type NewContactDraft,
} from '@/features/crm/new-contact'
import { requireCrmScope } from '@/features/crm/scope'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { upsertSpeakerByEmail } from '@/services/airtable/mutations-speakers'
import { listSpeakersInEvents } from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'

export type ContactCreated = {
  readonly speakerId: RecordId
  /** What the toast calls them: their name, or their address when they gave none. */
  readonly name: string
}

/**
 * Create a contact and put them on one of the caller's events.
 *
 * `upsertSpeakerByEmail` is the SAME writer the CFP submit, the event's Add Speaker sheet and
 * `addSpeakerToEventAction` all go through, and reusing it is not a shortcut. It is what
 * expires `speaker:{id}` and every affected event's roster, so the new row appears in the
 * directory, on the board and on the event's Speakers page without this action having to know
 * which tags any of them read through; and it is what MERGES the event link rather than
 * replacing it, so a returning speaker is not dropped from the events they were already on.
 *
 * `profileWrites: false`, which is the one option that matters here and is the same call the
 * public CFP makes for a co-participant. On the create branch it changes nothing: a brand new
 * person is written from the draft in full, which is the whole point. On the update branch it
 * writes ONLY the event link, so an address that turns out to belong to somebody already in
 * the base cannot have their name, company or biography overwritten by what an organizer typed
 * into a create form. A conference roster is a set of real people's profiles.
 *
 * An address ALREADY IN THE CALLER'S OWN CRM is refused rather than quietly linked. The link
 * would be legitimate - it is what `addSpeakerToEventAction` does - but the organizer pressed
 * "Add contact" and would be shown a success toast for a person they already had, so the
 * duplicate they were about to create is named instead. Somebody outside their scope is not
 * refused, because saying so would disclose that the address exists on another organizer's
 * event; they get the event link and nothing else, which is the honest outcome.
 */
export async function createContactAction(
  input: NewContactDraft,
): Promise<ActionResult<ContactCreated>> {
  try {
    const scope = await requireCrmScope()

    const checked = checkNewContact(input)
    if (!checked.ok) {
      throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, checked.reason)
    }
    const contact = checked.contact

    if (!scope.adminEventIds.includes(contact.eventId)) {
      // The same answer for "not an event of yours" and "not an event at all", so a probe
      // cannot tell them apart. `loadSpeakerProfile` gives the reasoning for its 404.
      throw new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'you cannot add contacts to that event', {
        eventId: contact.eventId,
      })
    }
    await requireEventRole(contact.eventId, 'admin')

    // The read the directory just performed, under the same cache entry, so this costs no
    // request. Normalized on both sides because the base stores whatever was typed.
    const wanted = contact.email.toLowerCase()
    const existing = (await listSpeakersInEvents(scope.eventIds)).find(
      (entry) => entry.speaker.email.trim().toLowerCase() === wanted,
    )
    if (existing !== undefined) {
      throw new AppError(
        ErrorIds.DATA_WRITE_FAIL,
        `${contact.email} is already in your CRM. Open their profile to add them to another event.`,
        { speakerId: existing.speaker.id },
      )
    }

    const speaker = await upsertSpeakerByEmail(
      {
        email: contact.email,
        firstName: contact.firstName,
        lastName: contact.lastName,
        company: contact.company,
        tagline: contact.tagline,
        eventIds: [contact.eventId],
      },
      'action',
      { profileWrites: false },
    )

    return actionOk({ speakerId: speaker.id, name: contactDisplayName(contact) })
  } catch (error) {
    return actionFailure(error)
  }
}
