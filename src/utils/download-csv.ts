// Hand a browser a CSV to save. Client-only, and the only copy of this.
//
// It was written twice, verbatim including its comment: once for the Abstracts export
// (`AbstractsOptionsMenu`) and once for the speaker import's error report. Two identical
// copies of a browser quirk is how one of them later gets a fix the other does not, so the
// second copy is what promoted it to a util rather than a third.
//
// Deliberately NOT unified with `AgendaListView`'s `downloadCsv`, which is a different
// implementation of a different job: it builds its CSV inside the same function and uses an
// object URL that it revokes. Folding that in would mean either giving this one a Blob path
// nothing else wants or rewriting a surface this change has no business touching.

/**
 * A data URL rather than `URL.createObjectURL`, so there is no object URL to revoke and no
 * leak if the click handler is interrupted.
 *
 * The BOM is what makes Excel open a UTF-8 CSV as UTF-8 instead of guessing a legacy codepage
 * and mangling every accented name. It is prepended here rather than by the callers so that
 * every CSV this app hands out has it, and so no caller has to know it exists.
 *
 * Escaping is NOT this function's job and must already have happened: `escapeCsv`
 * (`features/crm/import/csv-safe.ts`) is what quotes a cell and defuses a leading `=`, and it
 * has to run per cell, where the cell boundaries are still known.
 */
export function downloadCsv(filename: string, csv: string): void {
  const anchor = document.createElement('a')
  anchor.href = `data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${csv}`)}`
  anchor.download = filename
  anchor.click()
}
