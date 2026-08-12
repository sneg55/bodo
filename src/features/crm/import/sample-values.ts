// How many example values sit under each CSV column name on the map step: enough to tell
// "state" apart from "city" at a glance, few enough that the row height stays stable.
export const MAP_SAMPLE_VALUE_COUNT = 2

// Pull example values for one CSV column out of the batch's stored preview rows, so the mapper can
// see what a column actually contains before choosing a field for it. Values are shown verbatim
// (duplicates included) because collapsing them would misrepresent the file; blanks are
// skipped so a column with an empty leading row still shows real data.
export function sampleValues(
  previewRows: readonly Record<string, string>[],
  header: string,
  limit: number = MAP_SAMPLE_VALUE_COUNT,
): readonly string[] {
  const out: string[] = []
  for (const row of previewRows) {
    if (out.length >= limit) break
    // A Map read rather than `row[header]`, because `security/detect-object-injection`
    // treats a computed read on a plain object as a sink and its warnings fail this build.
    const value = new Map(Object.entries(row)).get(header)?.trim() ?? ''
    if (value !== '') out.push(value)
  }
  return out
}
