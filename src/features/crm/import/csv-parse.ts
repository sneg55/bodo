// RFC-4180-ish CSV parser. Client-side only: turns an uploaded file's text into
// headers and header-keyed row objects. Handles quoted fields, escaped double-quotes
// (""), embedded commas/newlines, and CRLF or LF endings. Speaker import files are
// small enough to parse fully in memory (no streaming).
export type ParsedCsv = {
  readonly headers: readonly string[]
  readonly rows: readonly Record<string, string>[]
}

// Mutable tokenizer state. Split out of the main loop so each step handler stays
// under the cognitive-complexity budget.
type ParseState = {
  records: string[][]
  record: string[]
  field: string
  inQuotes: boolean
}

function endField(st: ParseState): void {
  st.record.push(st.field)
  st.field = ''
}

function endRecord(st: ParseState): void {
  endField(st)
  st.records.push(st.record)
  st.record = []
}

// Consume one character while inside a quoted field; return chars consumed.
//
// `.at()` rather than `text[i]`, because `security/detect-object-injection` treats a
// computed read with a bare identifier index as an injection sink and its warnings fail
// this build.
function stepQuoted(st: ParseState, text: string, i: number): number {
  const ch = text.at(i)
  if (ch === '"') {
    if (text.at(i + 1) === '"') {
      st.field += '"'
      return 2
    }
    st.inQuotes = false
    return 1
  }
  st.field += ch ?? ''
  return 1
}

// Consume one character while outside quotes; return chars consumed.
function stepUnquoted(st: ParseState, text: string, i: number): number {
  const ch = text.at(i)
  if (ch === '"') {
    st.inQuotes = true
    return 1
  }
  if (ch === ',') {
    endField(st)
    return 1
  }
  if (ch === '\r') {
    endRecord(st)
    return text.at(i + 1) === '\n' ? 2 : 1
  }
  if (ch === '\n') {
    endRecord(st)
    return 1
  }
  st.field += ch ?? ''
  return 1
}

// Tokenize the whole text into an array of records, each a list of raw field values.
function splitRecords(text: string): string[][] {
  const st: ParseState = { records: [], record: [], field: '', inQuotes: false }
  let i = 0
  while (i < text.length) {
    i += st.inQuotes ? stepQuoted(st, text, i) : stepUnquoted(st, text, i)
  }
  // Flush a trailing record only if the last line had content (no phantom blank row).
  if (st.field !== '' || st.record.length > 0) endRecord(st)
  return st.records
}

// A record is "blank" when it is a single cell that is empty or whitespace-only (an empty
// physical line, or a space/tab-only line that spreadsheet exports often leave trailing).
function isBlank(record: string[]): boolean {
  return record.length === 1 && (record[0] ?? '').trim() === ''
}

export function parseCsv(text: string): ParsedCsv {
  const records = splitRecords(text).filter((r) => !isBlank(r))
  // `.at(0)` rather than array destructuring, so an empty document types as `undefined`
  // instead of TypeScript inferring the always-present element type of `records`.
  const headerRow = records.at(0)
  if (headerRow === undefined) return { headers: [], rows: [] }
  const dataRows = records.slice(1)
  const headers = headerRow.map((h) => h.trim())
  const rows = dataRows.map((cells) => {
    const entries = headers.map((header, idx) => [header, (cells.at(idx) ?? '').trim()] as const)
    // Object.fromEntries, not a computed assignment into a plain object literal: a header
    // literally named "__proto__" would hit Object.prototype's accessor setter on a
    // computed write and silently drop the value. Object.fromEntries creates a real own
    // property instead, so every header round-trips, including that one.
    return Object.fromEntries(entries)
  })
  return { headers, rows }
}
