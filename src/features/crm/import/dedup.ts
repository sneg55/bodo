// Email-normalized duplicate detection for the speaker import.
//
// This module exists because `upsertSpeakersBatch` cannot do it. Its snapshot of existing
// speakers is read once and refreshed only between 10-row chunks, so two rows sharing an
// email inside one chunk both plan as a create and produce two speaker records. Its file
// header says as much and names this module as the answer: the whole file is in memory here,
// before any row is written, which is the only place the question can be answered at all.
//
// The normalization is `trim().toLowerCase()` and it is not a free choice. `planRow` and
// `loadSpeakersByEmail` both key on exactly that, so `ada@example.com` and
// ` ADA@EXAMPLE.COM ` are already one person to the layer underneath. A different rule here
// (stripping Gmail dots, say, or casefolding the local part differently) would be worse than
// no rule at all: it would disagree with the matcher that actually decides the write.
//
// The same reasoning governs WHICH record wins when two speakers share one email; see
// `findDuplicates`.
//
// `dedupeRows` is the only producer of `DedupedSpeakerRows`, the branded type
// `upsertSpeakersBatch` accepts. If a commit path fails to typecheck with "readonly
// SpeakerImportRow[] is not assignable to DedupedSpeakerRows", that is this module telling you
// the dedup step is missing: pass the rows through `dedupeRows`, which drops the repeats and
// reports them in `dropped` so the summary can say so. The brand exists because a missed dedup
// step is otherwise silent - no error, no failing test, just two speaker records for one
// person.

// `winsEmailTie` comes from its own leaf module, NOT from `mutations-crm-import-plan.ts` where
// it used to live and where its two callers still meet. It is the one runtime value this file
// imports, and this file is reachable from `'use client'` code (`ImportWizard` uses
// `findDuplicates` for its offline repeat scan), so importing it from the plan module put
// `getClient`, `client.ts`, `scheduler.ts` and the table registry in the browser's module
// graph for a comparison of two strings. The type imports below are erased and cost nothing.
import { winsEmailTie } from '@/services/airtable/email-tie'
import type {
  DedupedSpeakerRows,
  SpeakerImportRow,
} from '@/services/airtable/mutations-crm-import-plan'
import type { Speaker } from '@/types/domain'

/** The one normalization. Must stay identical to `planRow`'s and `loadSpeakersByEmail`'s. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Marks a `findDuplicates` value as pointing at an earlier ROW of the same file rather than
 * at an existing speaker record. Exported so the preview does not hardcode the prefix.
 */
export const DUPLICATE_OF_ROW_PREFIX = 'row:'

/**
 * Only the identity half of a `Speaker` is read, so a caller with a lighter projection can
 * pass it without building whole records. A `readonly Speaker[]` still satisfies this.
 *
 * WHICH speakers, on the other hand, is not free. The array must be every speaker in the
 * base - the same set `loadSpeakersByEmail` reads with `client.listAll(TABLES.speakers)` -
 * because `findDuplicates` answers a question about a SET and a smaller set gives a different
 * answer. Specifically: pass a subset and a row whose speaker is outside it previews as a
 * create, then the commit resolves it to an update against the speaker the preview never saw.
 *
 * The CRM directory's row model is NOT a valid input, and it is worth naming because it is the
 * speaker array closest to hand: `CrmDirectoryView.rows` is one already-sliced PAGE
 * (`directory.ts`, via `pageRows`) of a list scoped to the viewer's events
 * (`listSpeakersInEvents`). Both make it a subset, and a speaker who presents at another event
 * entirely is exactly the case an import is most likely to hit.
 *
 * ORDER, unlike membership, does not matter at all: see `findDuplicates`.
 */
export type ExistingSpeaker = Pick<Speaker, 'id' | 'email'>

/**
 * Which rows collide, keyed by `rowNumber`.
 *
 * The value says WHAT the row collides with, and the two cases mean different things to the
 * organizer:
 *
 * - a speaker record id: this row matches somebody already in the CRM, so it will UPDATE
 *   them. Normal, and the reason an import is re-runnable at all.
 * - `row:<n>`: this row repeats an earlier row of the same file. Not normal. Two rows are
 *   claiming one person, and only one of them can win.
 *
 * A row that is both is reported as the repeat, because that is the case with a consequence:
 * `dedupeRows` will drop it, and the preview has to say so.
 *
 * The FIRST row of a repeated email is never flagged as a repeat. Only the later ones are,
 * and every one of them points at that first row rather than at its immediate predecessor,
 * so a run of three rows reads as "2 is the one that lands" instead of a chain.
 *
 * When two EXISTING speakers share one normalized email, `winsEmailTie` decides which one is
 * named, and it is the same function `loadSpeakersByEmail` uses to decide which one is
 * updated. Naming a different record here would preview `spk1` and then update `spk2`, the
 * same class of silent disagreement this file's header rejects for the normalization itself.
 *
 * `existing` must be the WHOLE base's speakers, not a page and not one event's roster; see
 * `ExistingSpeaker` for what a subset does to the preview.
 *
 * That is why the tie is not broken locally. A rule like "first wins" or "last wins" is a
 * rule about the ORDER of `existing`, and `existing` is whatever array a caller passes: the
 * directory's row model is sorted by family name, `listAll` is not sorted at all, and the two
 * would pick different records out of the same pair. Sharing the rule makes the answer a
 * property of the SET, so no caller can get it wrong by passing a differently ordered array.
 */
export function findDuplicates(
  rows: readonly SpeakerImportRow[],
  existing: readonly ExistingSpeaker[],
): ReadonlyMap<number, string> {
  const existingByEmail = new Map<string, string>()
  for (const speaker of existing) {
    const email = normalizeEmail(speaker.email)
    // The write layer's own tie-break, not a local one; see above.
    if (email !== '' && winsEmailTie(existingByEmail.get(email), speaker.id)) {
      existingByEmail.set(email, speaker.id)
    }
  }

  const firstRowByEmail = new Map<string, number>()
  const duplicates = new Map<number, string>()
  for (const row of rows) {
    const email = normalizeEmail(row.email)
    // A row with no email is not a duplicate of the next row with no email; it is invalid,
    // and `mapRow` or `planRow` reports it as such with its own reason.
    if (email === '') continue

    const firstRow = firstRowByEmail.get(email)
    if (firstRow !== undefined) {
      duplicates.set(row.rowNumber, `${DUPLICATE_OF_ROW_PREFIX}${firstRow}`)
      continue
    }
    firstRowByEmail.set(email, row.rowNumber)

    const speakerId = existingByEmail.get(email)
    if (speakerId !== undefined) duplicates.set(row.rowNumber, speakerId)
  }
  return duplicates
}

export type DedupedRows = {
  readonly rows: DedupedSpeakerRows
  /** `rowNumber`s removed, in file order, so the summary can name them. */
  readonly dropped: readonly number[]
}

/**
 * The batch `upsertSpeakersBatch` is safe to receive: at most one row per normalized email.
 *
 * Keeps the FIRST occurrence, not the last. Either is defensible - a later row can be a
 * correction - but first-wins matches the row the preview highlights as the one that lands,
 * and matches how `autoMapHeaders` resolves a contested field. Guessing that the last row is
 * the truer one would silently discard whichever row the organizer was looking at.
 *
 * A dropped row is dropped WHOLE, and that loses fields. Two rows for one person carrying
 * `firstName` and `bio` respectively land as a row with a `firstName` and no `bio`. Merging
 * them was considered and rejected: a merge has to decide what a non-empty cell in the later
 * row means against a non-empty cell in the earlier one, and either answer is a guess that
 * writes to real records without the organizer ever seeing it. Dropping is the smaller,
 * legible behaviour, and `dropped` names every row it happened to so the summary can say so
 * and the organizer can merge the two lines in their own file and re-upload.
 *
 * Rows with no email pass through untouched. They are invalid rather than duplicated, and
 * collapsing them here would hide N bad rows behind one outcome; the write layer answers
 * with one `Missing email` per row instead, which is what the error report needs.
 */
export function dedupeRows(rows: readonly SpeakerImportRow[]): DedupedRows {
  const seen = new Set<string>()
  const kept: SpeakerImportRow[] = []
  const dropped: number[] = []
  for (const row of rows) {
    const email = normalizeEmail(row.email)
    if (email !== '' && seen.has(email)) {
      dropped.push(row.rowNumber)
      continue
    }
    if (email !== '') seen.add(email)
    kept.push(row)
  }
  return { rows: brand(kept), dropped }
}

/**
 * The one place in `src/` the brand is applied. A cast is unavoidable - a brand has no runtime
 * value - so it is spent once, here, behind the function that has actually established the
 * property, rather than at each call site.
 *
 * Deliberately not exported, and there is deliberately no `assertDeduped` beside it. An
 * assert-shaped door was tried and moved to `tests/helpers/deduped-batch.ts`: its only real
 * caller is the write layer's own tests, and on this export surface it read like a safe
 * default while actually throwing, which would fail a whole import over one repeated email and
 * contradict `upsertSpeakersBatch`'s promise that one bad row never discards the good ones.
 * A production caller has an uploaded file and wants `dedupeRows`.
 */
function brand(rows: readonly SpeakerImportRow[]): DedupedSpeakerRows {
  return rows as DedupedSpeakerRows
}
