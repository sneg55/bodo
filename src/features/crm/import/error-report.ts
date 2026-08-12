// The downloadable "what did not land" file, and the one place that assembles its rows.
//
// Every RAW column of the original row is echoed back, which is the point of the format: the
// organizer fixes the cells in the file they already have and re-uploads it, rather than
// transcribing a list of row numbers back into a spreadsheet.

import { escapeCsv } from './csv-safe'

export type ErrorReportRow = {
  readonly rowNumber: number
  readonly raw: Record<string, string>
  readonly errors: readonly { field: string; message: string }[]
}

/** One thing that went wrong with one row of the uploaded file. */
export type ImportProblem = {
  readonly rowNumber: number
  /** Which column the organizer has to look at. `row` when it is the whole line. */
  readonly field: string
  readonly reason: string
}

/**
 * Gather every problem an import produced against the rows they came from.
 *
 * The three sources are deliberately merged into one file rather than three: a row the mapping
 * refused, a row dropped as a repeat of an earlier one, and a row the write layer failed are
 * all "lines you need to look at again", and an organizer fixing a file wants one list of
 * them. Sorted by row number, so the report reads down the file even though the three sources
 * are gathered at different moments.
 *
 * A problem whose row is not in `rawByRow` is kept with an empty raw record rather than
 * dropped: losing a reported failure because a lookup missed would be the worst of the
 * available behaviours, and the row number alone is still actionable.
 */
export function importErrorRows(
  problems: readonly ImportProblem[],
  rawByRow: ReadonlyMap<number, Record<string, string>>,
): readonly ErrorReportRow[] {
  return [...problems]
    .sort((left, right) => left.rowNumber - right.rowNumber)
    .map((problem) => ({
      rowNumber: problem.rowNumber,
      raw: rawByRow.get(problem.rowNumber) ?? {},
      errors: [{ field: problem.field, message: problem.reason }],
    }))
}

// Columns: row number, flattened errors, then every raw header seen in first-seen order.
export function buildErrorCsv(rows: readonly ErrorReportRow[]): string {
  const headers: string[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    for (const k of Object.keys(r.raw)) {
      if (!seen.has(k)) {
        seen.add(k)
        headers.push(k)
      }
    }
  }
  const head = ['row', 'errors', ...headers].map(escapeCsv).join(',')
  const lines = rows.map((r) => {
    const reasons = r.errors.map((e) => `${e.field}: ${e.message}`).join('; ')
    // A Map read rather than `r.raw[h]`, because `security/detect-object-injection`
    // treats a computed read on a plain object as a sink and its warnings fail this build.
    const rawByHeader = new Map(Object.entries(r.raw))
    const cells = [String(r.rowNumber), reasons, ...headers.map((h) => rawByHeader.get(h) ?? '')]
    return cells.map(escapeCsv).join(',')
  })
  return [head, ...lines].join('\n')
}
