// CSV's grammar, and nothing about speakers.
//
// A HAND-WRITTEN PARSER, and that is a deliberate choice rather than a missing dependency.
// CSV's real grammar is small (quoted fields, doubled quotes inside them, embedded newlines
// and commas) and every one of those cases is covered below and tested. Pulling a parser in
// would add a dependency to a Workers bundle for fifty lines, and the alternative people
// reach for, `text.split(',')`, silently corrupts exactly the row this feature exists to
// handle: `"Okafor, Ada",ada@example.com`.
//
// Split out of csv-import.ts for the file-size limit. The seam is real: this file knows what
// a cell is, that one knows what a speaker is.

/**
 * Split CSV text into rows of cells.
 *
 * Handles the four things that make CSV not a split: quoted fields, a doubled quote as a
 * literal quote inside one, and both commas and newlines inside quotes. CRLF is normalised
 * on the way in, since a file saved on Windows is the common case rather than the exotic one.
 */
export function parseCsv(text: string): readonly (readonly string[])[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const source = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')

  for (let index = 0; index < source.length; index += 1) {
    // `charAt`, not `source[index]`: indexing a string with a variable is the computed
    // index `security/detect-object-injection` refuses, and this loop has one per character.
    const char = source.charAt(index)
    if (quoted) {
      if (char !== '"') {
        cell += char
      } else if (source.charAt(index + 1) === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = false
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  // The last row has no trailing newline unless the file happens to end with one.
  row.push(cell)
  if (row.some((value) => value !== '') || rows.length === 0) rows.push(row)

  // A trailing blank line is not a row of one empty cell.
  return rows.filter((entry) => entry.some((value) => value.trim() !== ''))
}

/**
 * One name cell into a first and a last name.
 *
 * Two shapes, because both are what people actually write. `Okafor, Ada` is surname-first
 * and is what a spreadsheet sorted by surname exports; anything else splits at the LAST
 * space, so `Ada Nkemdirim Okafor` keeps the middle name with the first rather than losing
 * it. A single word is a first name: it is what the person is called, and inventing a
 * surname from nothing would be worse than leaving it empty.
 */
export function splitFullName(raw: string): { firstName: string; lastName: string } {
  const value = raw.trim().replaceAll(/\s+/gu, ' ')
  if (value === '') return { firstName: '', lastName: '' }

  const comma = value.indexOf(',')
  if (comma !== -1) {
    return {
      firstName: value.slice(comma + 1).trim(),
      lastName: value.slice(0, comma).trim(),
    }
  }

  const cut = value.lastIndexOf(' ')
  if (cut === -1) return { firstName: value, lastName: '' }
  return { firstName: value.slice(0, cut), lastName: value.slice(cut + 1) }
}
