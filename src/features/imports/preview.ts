// The dry run. BUILD_SPEC 5.0e, "Preview before commit".
//
// EVERY run is a dry run first: fetch, map, and report counts per entity type plus the
// Needs-email count, with warnings. Nothing is written until the organizer presses
// `Import`. This is cheap rather than an extra cost, because the dry run is exactly the
// reads the real run starts with, and the real run does them again anyway.
//
// The one thing this adds over `previewCounts` is the CREATE/UPDATE SPLIT, and it is the
// whole reason the preview is legible on a re-run. `previewCounts` puts everything under
// `created` because nothing has consulted `IntegrationMappings` at that point; here the
// event's mappings are indexed once, in the same direction and by the same function the
// run engine uses, so the preview and the run cannot disagree about what already exists.
// A second run that previews as a wall of creates is the idempotency key not matching,
// and that is exactly the thing an organizer needs to see BEFORE pressing the button.
//
// Nothing here writes. Nothing here claims. It is safe to call as often as a wizard step
// is re-rendered, and it takes its two reads as dependencies so a test never reaches the
// network.

import { previewCategories } from '@/features/imports/categories'
import type { SourceFetch, SourceRequest } from '@/features/imports/fetch-source'
import type { NormalizedImport, RoundTripGuard } from '@/features/imports/normalize'
import { authoredRemoteIds, importCount } from '@/features/imports/ports'
import type { IntegrationEntityType } from '@/services/accelevents/sync-types'
import { findRemoteMapping, type RemoteIndex } from '@/services/airtable/reads-imports'
import type { RecordId } from '@/types/domain'
import type {
  ImportCount,
  ImportCounts,
  ImportMapping,
  ImportPreview,
  ImportSource,
} from '@/types/imports'

export type ImportPreviewInput = {
  eventId: RecordId
  source: ImportSource
  sourceRef: string
  mapping: ImportMapping
}

export type ImportPreviewDeps = {
  /** The same uncached read the run makes. Cached, it would report stale creates. */
  loadRemoteIndex: (eventId: RecordId) => Promise<RemoteIndex>
  fetch: (request: SourceRequest, guard: RoundTripGuard) => Promise<SourceFetch>
}

export async function previewImport(
  input: ImportPreviewInput,
  deps: ImportPreviewDeps,
): Promise<ImportPreview> {
  const index = await deps.loadRemoteIndex(input.eventId)
  // The round-trip guard, supplied by this side rather than read inside the mapper, which
  // is what keeps the mapper pure. For Accelevents it names the remote ids bodo's own push
  // authored; for the other two it is empty, because bodo pushes to neither.
  const guard: RoundTripGuard = { authoredRemoteIds: authoredRemoteIds(index, input.source) }
  const request: SourceRequest = {
    source: input.source,
    sourceRef: input.sourceRef,
    mapping: input.mapping,
  }
  const fetched = await deps.fetch(request, guard)

  return {
    source: input.source,
    sourceRef: input.sourceRef,
    counts: splitCounts(fetched.normalized, index, input.source),
    needsEmailCount: fetched.normalized.needsEmail.length,
    // Empty for the two typed sources. Sessionize's categories are user-named, so this is
    // the list the wizard's mapping step turns into one `Select` each.
    categories: previewCategories(fetched.categories),
    warnings: warningsFor(fetched.normalized),
  }
}

/**
 * `previewCounts` with `IntegrationMappings` consulted.
 *
 * Written against the same `findRemoteMapping` the ledger uses, with the same
 * `entityType` narrowing, because the namespace is the SOURCE and not the entity: within
 * one source a room and a category item can carry the same integer, and without the check
 * a session would resolve to a room's mapping and preview as an update that will not
 * happen.
 */
export function splitCounts(
  normalized: NormalizedImport,
  index: RemoteIndex,
  source: ImportSource,
): ImportCounts {
  const split = (
    entityType: IntegrationEntityType,
    remoteIds: readonly string[],
    skipped = 0,
  ): ImportCount => {
    let created = 0
    let updated = 0
    for (const remoteId of remoteIds) {
      if (findRemoteMapping(index, source, remoteId, entityType) === undefined) created += 1
      else updated += 1
    }
    return importCount(created, updated, skipped)
  }

  // Blank-named references are dropped by the metadata phase rather than created, so they
  // are dropped here too. A preview that counts a row the run will not write is a preview
  // the organizer cannot reconcile against the finished run.
  const named = (refs: NormalizedImport['rooms']): readonly string[] =>
    refs.filter((ref) => ref.name.trim() !== '').map((ref) => ref.remoteId)

  const importable = normalized.submissions.filter(
    (submission) =>
      submission.participants.length > 0 ||
      findRemoteMapping(index, source, submission.remoteId, 'submission') !== undefined,
  )

  return {
    room: split('room', named(normalized.rooms)),
    track: split('track', named(normalized.tracks)),
    tag: split('tag', named(normalized.tags)),
    speaker: split(
      'speaker',
      normalized.speakers.map((speaker) => speaker.remoteId),
      normalized.skipped.speakers,
    ),
    submission: split(
      'submission',
      importable.map((submission) => submission.remoteId),
      // Everything the run will not write: the round-trip skips the mapper already
      // counted, the service sessions bodo has no agenda row for, and the sessions whose
      // whole cast failed to resolve. A submission needs a submitter, and that is a
      // required link.
      normalized.skipped.submissions +
        normalized.agendaItems.length +
        (normalized.submissions.length - importable.length),
    ),
    // Participants have no remote identity of their own: they are rows on a submission,
    // written with it at create time, so there is nothing here to match against.
    participant: importCount(
      importable.reduce((sum, submission) => sum + submission.participants.length, 0),
      0,
    ),
  }
}

/**
 * What the organizer should know before pressing Import. Never a silent skip.
 *
 * The mapper's own warnings come first because they name what it could not map, and the
 * round-trip line is appended because it is the one warning the ENGINE is responsible for:
 * BUILD_SPEC requires that a pull from an event bodo has been pushing into names how many
 * rows it skipped for that reason, rather than quietly returning a smaller number.
 */
export function warningsFor(normalized: NormalizedImport): readonly string[] {
  const skipped = normalized.skipped.speakers + normalized.skipped.submissions
  if (skipped === 0) return normalized.warnings
  return [
    ...normalized.warnings,
    `${String(skipped)} records were created by bodo's own sync and will not be imported back.`,
  ]
}
