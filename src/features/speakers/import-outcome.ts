// Which rows of a speaker CSV will CREATE somebody and which will UPDATE somebody.
//
// The import upserts by email, so "imported 3 speakers" is true of three creates, three
// updates, and every mixture in between. That is the one thing an operator running a bulk
// import needs told, and the reason is not cosmetic: re-running a corrected file is the
// ordinary second step of an import, and a run that reports the same sentence whether it
// added three people or edited three existing records gives nobody a way to notice that a
// column was mapped wrong and forty profiles were just rewritten.
//
// The vocabulary is the CRM import wizard's, verbatim: `N to create, N to update` before the
// commit, `Created / Updated / Failed` after it. Two importers in one product describing the
// same outcome in two dialects is a familiarity cost with nothing behind it.
//
// Pure and client-safe: the preview in `SpeakerImportSheet` and the count in
// `importSpeakersAction` are the same arithmetic, and running it twice from one function is
// what stops the preview promising a create the commit then performs as an update.

import { normalizeSpeakerEmail } from '@/features/speakers/add-speaker-draft'

export type SpeakerImportDisposition = 'create' | 'update'

export type SpeakerImportCounts = {
  readonly create: number
  readonly update: number
}

/**
 * The set of addresses already holding a speaker record, normalized once.
 *
 * It must be the WHOLE Speakers table rather than this event's roster: the upsert matches on
 * the email column across the base, so somebody who speaks at another event entirely is an
 * update here and would otherwise be previewed as a create.
 */
export function existingEmailSet(emails: Iterable<string>): ReadonlySet<string> {
  return new Set([...emails].map((email) => normalizeSpeakerEmail(email)))
}

export function dispositionOf(
  email: string,
  existing: ReadonlySet<string>,
): SpeakerImportDisposition {
  return existing.has(normalizeSpeakerEmail(email)) ? 'update' : 'create'
}

/**
 * How the rows split, counted in file order.
 *
 * A repeated address inside one file counts ONCE, and as whatever the first occurrence was:
 * `planSpeakerImport` already refuses the later rows with a per-line problem, so counting
 * them again here would report a create that is never attempted.
 */
export function importCounts(
  emails: readonly string[],
  existing: ReadonlySet<string>,
): SpeakerImportCounts {
  const seen = new Set<string>()
  let create = 0
  let update = 0
  for (const raw of emails) {
    const email = normalizeSpeakerEmail(raw)
    if (email === '' || seen.has(email)) continue
    seen.add(email)
    if (existing.has(email)) update += 1
    else create += 1
  }
  return { create, update }
}

/** `3 to create, 0 to update`, the CRM wizard's own sentence. */
export function importCountsLabel(counts: SpeakerImportCounts): string {
  return `${String(counts.create)} to create, ${String(counts.update)} to update`
}
