// `upsertSpeakersBatch` takes `DedupedSpeakerRows`, a branded type only `dedupeRows` produces
// in `src/`, so that a commit path cannot skip the dedup step (features/crm/import/dedup.ts).
// A test that hand-builds its rows already knows they hold the property but has no way to say
// so, which is what this helper is for.
//
// It VERIFIES rather than launders: `dedupeRows` decides, and a batch that actually repeats an
// email throws here instead of reaching the write. That keeps the brand honest - the helper
// cannot be used to sneak duplicates past the type - while keeping the assertion out of
// `src/`, where a function named like a safe default that throws on real uploaded data would
// be a foot-gun for the import wizard.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { dedupeRows } from '@/features/crm/import/dedup'
import type {
  DedupedSpeakerRows,
  SpeakerImportRow,
} from '@/services/airtable/mutations-crm-import-plan'

export function dedupedBatch(rows: readonly SpeakerImportRow[]): DedupedSpeakerRows {
  const { rows: kept, dropped } = dedupeRows(rows)
  if (dropped.length > 0) {
    throw new AppError(
      ErrorIds.CRM_BATCH_NOT_DEDUPED,
      `Speaker import batch repeats an email on row(s) ${dropped.join(', ')}`,
      { rows: dropped },
    )
  }
  // `kept` rather than `rows`: same contents once nothing was dropped, and it carries the
  // brand already, so this file holds no cast of its own.
  return kept
}
