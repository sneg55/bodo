// Neutralize spreadsheet formula injection: prefix a cell that a spreadsheet would treat as a
// formula lead (= + - @, or a tab/CR) with an apostrophe so it renders as literal text.
export function neutralizeFormula(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
}

// Escape a field per RFC 4180: wrap in quotes when it contains a comma, quote, or newline.
//
// The newline class includes a bare `\r`, which the warpdrive original did not: that
// source only checked `/[",\n]/`. A bare `\r` left unquoted is not cosmetic here,
// because csv-parse.ts's tokenizer treats a lone `\r` as a record boundary, so an
// unescaped one would split a single field into two records on the next parse and
// corrupt a re-uploaded file. Deliberate departure from the source, not a mechanical
// port.
export function escapeCsv(v: string): string {
  const safe = neutralizeFormula(v)
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
