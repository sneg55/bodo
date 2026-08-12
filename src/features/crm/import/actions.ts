'use server'

// The speaker CSV import's two Server Actions: what the preview asks, and the commit itself.
//
// AUTHORIZATION IS RECOMPUTED HERE, as it is in every other CRM action and for the same
// reason: an action is reachable by POST whether or not `(admin)/admin/crm/layout.tsx` ever
// rendered, and a layout does not revalidate on every navigation. `requireCrmScope()` answers
// which events are the caller's, and the commit checks the ONE event it is about to write to
// against that set. Capability comes from EventMemberships, never from a role in the session
// cookie (BUILD_SPEC section 4).
//
// Both arguments are parsed rather than trusted (`./commit.ts`): the wizard is one client and
// anything that can reach the endpoint is another.
//
// They live in their own file rather than in `src/features/crm/actions.ts` because a
// `'use server'` file may only export async functions, so the import's pure half - `summarize`,
// the payload schemas, the row cap - has to sit outside one, and keeping the two beside each
// other in `import/` is what makes that split legible.

import { AppError, ErrorIds } from '@/constants/errorIds'
import {
  type ImportSummary,
  parseImportPayload,
  parsePreviewPayload,
  payloadRows,
  summarize,
} from '@/features/crm/import/commit'
import { DUPLICATE_OF_ROW_PREFIX, dedupeRows, findDuplicates } from '@/features/crm/import/dedup'
import { requireCrmScope } from '@/features/crm/scope'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { upsertSpeakersBatch } from '@/services/airtable/mutations-crm-import'
import { listSpeakerIdentities } from '@/services/airtable/mutations-crm-import-plan'
import { claimOnce } from '@/utils/cf'

/**
 * How long one submission id stays claimed.
 *
 * Long enough to cover a slow commit and the double submit it invites (500 rows is 50
 * sequential Airtable requests), short enough that a claim left behind by a request that died
 * mid-flight does not wedge the surface for the rest of the day. A deliberate retry is not
 * affected either way: the wizard mints a NEW submission id after a failure, so the claim only
 * ever refuses the same attempt arriving twice.
 */
const IMPORT_CLAIM_MS = 5 * 60 * 1000

/**
 * What a row collides with, said in a way that names no record.
 *
 * `findDuplicates` answers with the matched speaker's record id, which the preview does not
 * need and should not be handed: an organizer may import against a base whose speakers mostly
 * belong to other people's events, and "this address is already a speaker" is the whole
 * answer. `row:<n>` passes through unchanged, because that one is about the organizer's own
 * file and the row number is exactly what they need to fix it.
 */
const EXISTING_SPEAKER = 'existing'

export type ImportPreview = {
  /** `[rowNumber, 'existing' | 'row:<n>']`, as pairs because a Map does not cross the wire. */
  readonly duplicates: readonly (readonly [number, string])[]
}

/**
 * Which rows will update somebody rather than create them, and which repeat an earlier row.
 *
 * The existing-speaker set is the WHOLE Speakers table, read through the same function the
 * write uses (`listSpeakerIdentities`). It cannot be the CRM directory's rows: those are one
 * already-sliced page of a list scoped to the viewer's events, so a row whose speaker presents
 * at another event entirely would preview as a create and then be updated by the commit.
 */
export async function previewSpeakerImportAction(
  input: unknown,
): Promise<ActionResult<ImportPreview>> {
  try {
    await requireCrmScope()
    const rows = parsePreviewPayload(input)

    const duplicates = findDuplicates(rows, await listSpeakerIdentities())
    return actionOk({
      duplicates: [...duplicates].map(
        ([rowNumber, target]) =>
          [
            rowNumber,
            target.startsWith(DUPLICATE_OF_ROW_PREFIX) ? target : EXISTING_SPEAKER,
          ] as const,
      ),
    })
  } catch (error) {
    return actionFailure(error)
  }
}

export type ImportCommitted = {
  readonly summary: ImportSummary
  /**
   * Rows dropped as repeats of an earlier row in the same file, by row number. Not failures:
   * nothing was wrong with them except that the file said the same person twice, and the
   * summary names them so the organizer can merge the lines and re-upload if the later row
   * carried something the earlier one did not.
   */
  readonly skipped: readonly number[]
}

/**
 * Commit the mapped rows against one event.
 *
 * The order is deliberate: authorize, then read the payload, then claim, then write.
 *
 * `dedupeRows` is not optional and is not a formality. `upsertSpeakersBatch` takes a branded
 * batch that only that function produces, because its existing-speaker snapshot refreshes
 * between 10-row chunks: two rows sharing an address inside one chunk would otherwise both
 * plan as a create and silently produce two speaker records.
 *
 * The claim is what makes a double submit land once. It is keyed on the caller's own id plus
 * the wizard's submission id, so no client can name a key that collides with another
 * organizer's import, and its holder is a fresh id per attempt: `claimOnce` grants a repeat
 * claim to the SAME holder, so reusing anything stable here would grant the second press too.
 *
 * A refused claim answers with `CRM_IMPORT_ALREADY_CLAIMED` rather than a generic write
 * failure, and that distinction is load-bearing rather than cosmetic: the wizard regenerates
 * its submission id after a failure so a genuine failure can be retried, and regenerating on
 * THIS one would re-arm the guard against itself, leaving it protecting only the window the
 * disabled button already covers.
 */
export async function commitSpeakerImportAction(
  input: unknown,
): Promise<ActionResult<ImportCommitted>> {
  try {
    const scope = await requireCrmScope()
    const payload = parseImportPayload(input)

    if (!scope.eventIds.includes(payload.eventId)) {
      throw new AppError(
        ErrorIds.AUTH_FORBIDDEN_ROLE,
        'that event is not one of yours, so speakers cannot be imported into it',
        { eventId: payload.eventId },
      )
    }

    const { rows, dropped } = dedupeRows(payloadRows(payload))

    const claim = await claimOnce(
      `crm-import:${scope.userId}:${payload.submissionId}`,
      crypto.randomUUID(),
      IMPORT_CLAIM_MS,
    )
    if (!claim.granted) {
      // Its own id, not DATA_WRITE_FAIL, because the client has to tell this failure from
      // every other one: it mints a fresh submission id after a failed commit so a genuine
      // write failure stays retryable, and doing that HERE would hand the next press a key
      // this guard has never seen. That is the one failure the regeneration must not answer.
      throw new AppError(
        ErrorIds.CRM_IMPORT_ALREADY_CLAIMED,
        'This import has already been submitted. Reload the page to see what landed.',
        { submissionId: payload.submissionId },
      )
    }

    const outcomes = await upsertSpeakersBatch('action', payload.eventId, rows)
    return actionOk({ summary: summarize(outcomes), skipped: dropped })
  } catch (error) {
    return actionFailure(error)
  }
}
