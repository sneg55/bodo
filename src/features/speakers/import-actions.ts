'use server'

// Bulk import from a CSV. SPK-03.
//
// The text is parsed on the CLIENT and the parsed rows are sent, so the operator sees the
// preview and the per-line problems before anything is written. The server does not trust
// that: it re-checks the addresses and the statuses, because these actions are reachable by
// POST with no page ever rendering.
//
// UPSERT BY EMAIL, not create. Re-importing a corrected file is the ordinary second step of a
// bulk import, and a create-only path would produce a duplicate record for every person in
// it. `upsertSpeakerByEmail` also merges the event link rather than replacing it, so importing
// somebody who already speaks at another event does not drop them from it.
//
// WHICH ROWS ARE WHICH IS THE REPORT, and it used to be missing. "Imported 3 speakers" is
// true of three creates, three updates and every mixture in between, so a run that quietly
// rewrote forty existing profiles read exactly like one that added forty people. Both actions
// here answer the same question with the same arithmetic (`import-outcome.ts`): the preview
// says `N to create, N to update` before the commit and the commit reports Created, Updated
// and Failed separately, which is the CRM import wizard's vocabulary verbatim.
//
// SEQUENTIAL, not `Promise.all`. Each upsert is a read followed by a write, and firing eighty
// of those at once would trip the per-base rate limit that BUILD_SPEC 3.1 describes; the DAL's
// scheduler would then queue them anyway, less predictably. A row that fails is reported and
// the rest continue, because a half-finished import an operator can see is better than an
// all-or-nothing one that rolls nothing back anyway.
//
// EVERY OPTIONAL CELL IS ABSENT WHEN THE FILE DID NOT CARRY IT, which is the same rule Add
// Speaker follows and for the same reason. `speakerFields` reads `''` as a request to CLEAR a
// column (services/airtable/to-fields.ts), so the old `row.company ?? ''` turned a file with
// no Company column into a run that deleted the company off every person in it, and the
// unconditional `?? 'prospect'` demoted every confirmed speaker the file named. `planSpeaker
// Import` already omits a cell it did not find, so passing the row's own values through is
// both the fix and the smaller code.

import { SPEAKER_STATUSES } from '@/constants/status'
import { requireEventRole } from '@/features/auth/wiring'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { normalizeSpeakerEmail } from '@/features/speakers/add-speaker-draft'
import type { SpeakerImportRow } from '@/features/speakers/csv-import'
import { existingEmailSet } from '@/features/speakers/import-outcome'
import { listSpeakerIdentities } from '@/services/airtable/mutations-crm-import-plan'
import { upsertSpeakerByEmail } from '@/services/airtable/mutations-speakers'
import type { RecordId } from '@/types/domain'

export type SpeakerImportSummary = {
  /** Rows that produced a speaker record that did not exist before. */
  readonly created: number
  /** Rows that resolved onto an existing record and edited it. */
  readonly updated: number
  /** `created + updated`, kept because it is the number the toast has always shown. */
  readonly imported: number
  /** The addresses whose write was rejected, so the operator can fix those lines. */
  readonly failed: readonly string[]
}

/**
 * Which of these addresses already hold a speaker record, answered before anything is written.
 *
 * Only the INTERSECTION comes back, never the base's speaker list: an organizer may import
 * against a base whose speakers mostly belong to other people's events, and "this address is
 * already a speaker" is the whole answer the preview needs.
 *
 * The existing set is the WHOLE Speakers table, read through the same uncached function the
 * CRM wizard's preview uses. It cannot be this event's roster: the upsert matches on the email
 * column across the base, so somebody who speaks at another event entirely would preview as a
 * create and then be performed as an update, which is the exact disagreement a preview exists
 * to prevent.
 */
export async function previewSpeakerImportAction(input: {
  eventId: RecordId
  emails: readonly string[]
}): Promise<ActionResult<{ existing: readonly string[] }>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const known = existingEmailSet((await listSpeakerIdentities()).map((row) => row.email))
    const asked = new Set(input.emails.map((email) => normalizeSpeakerEmail(email)))
    return actionOk({ existing: [...asked].filter((email) => known.has(email)) })
  } catch (error) {
    return actionFailure(error)
  }
}

export async function importSpeakersAction(input: {
  eventId: RecordId
  rows: readonly SpeakerImportRow[]
}): Promise<ActionResult<SpeakerImportSummary>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    // One `listAll` rather than a lookup per row: the upsert underneath already reads the
    // address it is about to write, and a second read per row would double an eighty-row
    // import's request count for a count.
    const known = new Set(existingEmailSet((await listSpeakerIdentities()).map((row) => row.email)))

    let created = 0
    let updated = 0
    const failed: string[] = []
    for (const row of input.rows) {
      const email = normalizeSpeakerEmail(row.email)
      const existed = known.has(email)
      try {
        await upsertSpeakerByEmail({
          email,
          firstName: row.firstName,
          lastName: row.lastName,
          company: row.company,
          tagline: row.tagline,
          bio: row.bio,
          dietary: row.dietary,
          travelNotes: row.travelNotes,
          // Re-checked here rather than trusted: the client parsed it, but the client is not
          // what decides whether a value may reach a single-select column. Then absent
          // unless the file said so, and only defaulted for somebody who does not exist yet.
          // Writing `prospect` over a returning speaker is the demotion this file's header
          // describes.
          status:
            SPEAKER_STATUSES.find((value) => value === row.status) ??
            (existed ? undefined : 'prospect'),
          eventIds: [input.eventId],
        })
        if (existed) updated += 1
        else {
          created += 1
          // So a file repeating one address counts one create and then one update rather
          // than two creates. `planSpeakerImport` already refuses the repeat with a per-line
          // problem, but this action is reachable by POST and does not get to assume it.
          known.add(email)
        }
      } catch {
        failed.push(row.email)
      }
    }

    return actionOk({ created, updated, imported: created + updated, failed })
  } catch (error) {
    return actionFailure(error)
  }
}
