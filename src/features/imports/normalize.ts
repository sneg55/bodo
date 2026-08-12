// The normalize entry point: what the run engine imports. Pure. BUILD_SPEC 5.0e.
//
// One function per source, all three returning the same `NormalizedImport`, so the run
// engine's dependency walk (metadata, speakers, submissions, agenda) is written once and
// does not branch on provider. The per-source mapping lives in the three files this
// re-exports; the shapes and the email rule live in `normalize-shared.ts`.
//
// Split across four files because each source's quirks are the bulk of its mapping, and
// one file carrying all three ran past the 300-line ceiling this repo enforces.

import type { NormalizedImport, PendingNeedsEmail } from '@/features/imports/normalize-shared'
import type { RecordId } from '@/types/domain'
import {
  EMPTY_IMPORT_COUNT,
  type ImportCount,
  type ImportCounts,
  type ImportEntityType,
  type NeedsEmailRow,
} from '@/types/imports'

export {
  type AcceleventsPayload,
  normalizeAccelevents,
  type RoundTripGuard,
} from '@/features/imports/normalize-accelevents'
export {
  normalizeSessionboard,
  type SessionboardPayload,
} from '@/features/imports/normalize-sessionboard'
export { normalizeSessionize } from '@/features/imports/normalize-sessionize'
export type {
  NormalizedAgendaItem,
  NormalizedImport,
  NormalizedParticipant,
  NormalizedRef,
  NormalizedSpeaker,
  NormalizedSubmission,
  PendingNeedsEmail,
} from '@/features/imports/normalize-shared'

/**
 * Dry-run counts, for the preview the organizer confirms before anything is written.
 *
 * Everything lands under `created` here because nothing has looked in
 * `IntegrationMappings` yet; the run engine moves rows into `updated` once it has. That
 * distinction is the whole value of two numbers: on a re-run, a wall of creates means
 * the idempotency key stopped matching, and one number would hide it.
 */
export function previewCounts(normalized: NormalizedImport): ImportCounts {
  const entry = (created: number, skipped = 0): ImportCount => ({
    ...EMPTY_IMPORT_COUNT,
    created,
    skipped,
  })
  const participants = normalized.submissions.reduce(
    (sum, submission) => sum + submission.participants.length,
    0,
  )

  const counts: Record<ImportEntityType, ImportCount> = {
    room: entry(normalized.rooms.length),
    track: entry(normalized.tracks.length),
    tag: entry(normalized.tags.length),
    speaker: entry(normalized.speakers.length, normalized.skipped.speakers),
    submission: entry(normalized.submissions.length, normalized.skipped.submissions),
    participant: entry(participants),
  }
  return counts
}

/**
 * Completes the Needs-email rows once the DAL knows each speaker's local id.
 *
 * A speaker the write produced no id for is dropped rather than reported with a blank
 * id, which would render a row on the Needs-email screen that opens nothing.
 */
export function toNeedsEmailRows(
  pending: readonly PendingNeedsEmail[],
  idByRemoteId: ReadonlyMap<string, RecordId>,
): readonly NeedsEmailRow[] {
  return pending.flatMap((row) => {
    const speakerId = idByRemoteId.get(row.remoteId)
    return speakerId === undefined ? [] : [{ ...row, speakerId }]
  })
}
