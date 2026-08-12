'use server'

// Adding one speaker by hand, and the organizer's edit of a speaker's profile content.
// SPK-01, SPK-02, CNT-10.
//
// The edit reuses `saveSpeakerProfile`, the same writer the speaker's own portal form calls,
// rather than adding an admin-only path to the Speakers table. That matters beyond tidiness:
// the writer is what expires `speaker:{id}`, the event's speaker list and the submissions
// list, and a second write that forgot one of those three would leave an organizer looking at
// a roster that still showed the old name.
//
// Both authorize for themselves, per BUILD_SPEC 4: an action is reachable by POST with no page
// ever rendering, and the route group's guard is a redirect for browsers, not a boundary.
//
// PARTIAL BY CONSTRUCTION, and that is the `compact` contract doing its job: only the fields
// these forms own are sent, so nothing here can blank the pronouns, the gender, the phone or
// the social links that the speaker maintains in their own portal. `blank()` at the Airtable
// boundary turns a cleared field into the `null` that actually clears it.
//
// The CSV import lives next door in `import-actions.ts` and the roster's inline status editor
// in `status-actions.ts`, because a `'use server'` file may only export async functions and
// each of those needs pure helpers beside it.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { SpeakerStatus } from '@/constants/status'
import { requireEventRole } from '@/features/auth/wiring'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import {
  type AddSpeakerInput,
  assertSpeakerEmail,
  assertSpeakerStatus,
  BIO_MAX_LENGTH,
  buildAddSpeakerDraft,
} from '@/features/speakers/add-speaker-draft'
import { resolveEventSpeaker } from '@/features/speakers/resolve-speaker'
import { saveSpeakerProfile, upsertSpeakerByEmail } from '@/services/airtable/mutations-speakers'
import { findSpeakerByEmail } from '@/services/airtable/queries'
import type { RecordId, Speaker } from '@/types/domain'

export type SpeakerProfileInput = {
  eventId: RecordId
  speakerId: RecordId
  firstName: string
  lastName: string
  company: string
  tagline: string
  bio: string
  headshotUrl: string
  /** Client input, checked against the closed vocabulary. */
  status: string
  dietary: string
  travelNotes: string
}

/**
 * What one Add Speaker submission did, said in a word the UI can print.
 *
 * `exists` is not a failure and not a write: it is the action ANSWERING that the address
 * already belongs to a named person, so the sheet can name them and ask. See below.
 */
export type AddSpeakerResult =
  | { readonly outcome: 'created'; readonly speakerId: RecordId; readonly name: string }
  | { readonly outcome: 'updated'; readonly speakerId: RecordId; readonly name: string }
  | {
      readonly outcome: 'exists'
      readonly speakerId: RecordId
      readonly name: string
      readonly status: SpeakerStatus
    }

/**
 * Add one speaker by hand. SPK-01, SPK-02.
 *
 * The roster could be filled two ways, by a CFP submission or by a CSV, and neither is what
 * an organizer does when somebody says yes over email. Pasting one person into a spreadsheet
 * to import them back is not a workflow, it is a workaround for a missing button.
 *
 * It goes through `upsertSpeakerByEmail`, the same writer the CSV import uses, rather than a
 * create. Adding an address that is already on the roster is a correction, not an error, and
 * the upsert also MERGES the event link, so adding somebody who already speaks at another
 * event does not drop them from it. A create-only path would either duplicate the record or
 * refuse a perfectly reasonable second attempt.
 *
 * BUT AN UPSERT MUST NOT BE SILENT, and for a long time this one was. The sheet said "Saved
 * successfully" whether it had created a person or rewritten one, so an organizer who
 * mistyped nothing at all and simply re-entered a returning speaker got a Confirmed record
 * demoted to Prospect and a company cleared, with the only visible trace being a tab count
 * that went down by one. Two things fix that and both are here:
 *
 *   - The FIRST submit for an address that already exists WRITES NOTHING. It comes back as
 *     `exists`, naming the person and the status they currently hold, and the sheet turns its
 *     button into `Update <name>`. Updating a real record is then a deliberate second press,
 *     which is what it always should have been.
 *   - `confirmUpdate` carries that decision back, and the outcome says which of the two
 *     things actually happened, so `created` and `updated` are distinguishable from the UI
 *     alone rather than being one indistinguishable "saved".
 *
 * WHICH FIELDS the confirmed update is allowed to write is `buildAddSpeakerDraft`'s question,
 * and the whole of the answer is there: a box the organizer did not fill in is absent, never
 * empty, and the Status select's default is not an opinion about somebody else's record.
 *
 * One name field, split by `splitFullName`, because that is how a person types a name and the
 * importer already had to learn the same rules.
 */
export async function addSpeakerAction(
  input: AddSpeakerInput & {
    eventId: RecordId
    /** Set by the sheet's second press, once the organizer has been told who this is. */
    confirmUpdate?: boolean
  },
): Promise<ActionResult<AddSpeakerResult>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    // Validated before the lookup so a typo is refused as a typo rather than reported as a
    // new person, and read UNCACHED (`findSpeakerByEmail`, reads-identity.ts) because
    // choosing between create and update from a cached answer is how one speaker ends up
    // with two records a few hundred milliseconds apart.
    const email = assertSpeakerEmail(input.email)
    const existing = await findSpeakerByEmail(email)

    if (existing !== undefined && input.confirmUpdate !== true) {
      return actionOk({
        outcome: 'exists' as const,
        speakerId: existing.id,
        name: speakerDisplayName(existing),
        status: existing.status ?? 'prospect',
      })
    }

    const draft = buildAddSpeakerDraft(input, { exists: existing !== undefined })
    const speaker = await upsertSpeakerByEmail({ ...draft, eventIds: [input.eventId] })

    // Two returns rather than one with a computed `outcome`, so each branch is a plain
    // object literal of one variant and nothing rests on how a union distributes.
    if (existing === undefined) {
      return actionOk({
        outcome: 'created' as const,
        speakerId: speaker.id,
        name: speakerDisplayName(speaker),
      })
    }
    return actionOk({
      outcome: 'updated' as const,
      speakerId: speaker.id,
      name: speakerDisplayName(speaker),
    })
  } catch (error) {
    return actionFailure(error)
  }
}

export async function saveSpeakerProfileAction(
  input: SpeakerProfileInput,
): Promise<ActionResult<{ speakerId: RecordId }>> {
  try {
    return actionOk(await save(input))
  } catch (error) {
    return actionFailure(error)
  }
}

async function save(input: SpeakerProfileInput): Promise<{ speakerId: RecordId }> {
  await requireEventRole(input.eventId, 'admin')

  // The event in the URL scopes the write, the rule the team writes follow: a speaker id is
  // client input, so it is resolved against the AUTHORIZED event's own roster before it is
  // touched. Without this an admin of one event could rewrite another event's speaker by
  // posting their record id. Shared with the headshot upload route, which takes the same id
  // from a query string and needs the same answer; see resolve-speaker.ts.
  const speaker = await resolveEventSpeaker(input.eventId, input.speakerId)

  if (input.bio.length > BIO_MAX_LENGTH) {
    throw new AppError(
      ErrorIds.SUB_VALIDATION_FAIL,
      `Biography is capped at ${String(BIO_MAX_LENGTH)} characters`,
      { speakerId: input.speakerId, length: input.bio.length },
    )
  }

  await saveSpeakerProfile({
    eventId: input.eventId,
    speakerId: speaker.id,
    draft: {
      // The address is the identity every other row links on and is never taken from this
      // form, exactly as the portal's own editor refuses to take it: accepting one here
      // would let an organizer point a speaker record at somebody else's account.
      email: speaker.email,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      company: input.company.trim(),
      tagline: input.tagline.trim(),
      bio: input.bio.trim(),
      headshotUrl: input.headshotUrl.trim(),
      status: assertSpeakerStatus(input.status, input.speakerId),
      dietary: input.dietary.trim(),
      travelNotes: input.travelNotes.trim(),
    },
  })

  return { speakerId: speaker.id }
}

/**
 * The name to say back to the organizer, falling back to the address exactly as the roster
 * does: a record created by a CFP submit may have no name yet, and "already belongs to" with
 * a blank after it is worse than no sentence at all.
 */
function speakerDisplayName(speaker: Speaker): string {
  const name = `${speaker.firstName} ${speaker.lastName}`.trim()
  return name === '' ? speaker.email : name
}
