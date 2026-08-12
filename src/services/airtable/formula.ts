// Building `filterByFormula` strings safely.
//
// A formula goes into a query string and is evaluated by Airtable, so an
// unescaped apostrophe in a value does not just break the query: `code = 'O'Neil'`
// parses as a truncated string followed by junk, and Airtable's answer to a
// malformed filter is to ignore it and return the whole table. A read that
// silently widens is worse than one that fails, which is why every value goes
// through `quote()`.
//
// Deliberately small: only the two shapes the reads in this directory need. Link
// fields are absent on purpose, because a formula sees a linked record as its
// primary field's text, never as a record id, so there is no correct way to write
// "where event is recXXX" here. See reads.ts for what is done instead.

/**
 * A string literal for a formula. Backslash first, then the quote, so an escaped
 * backslash is not re-escaped.
 */
export function quote(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

/** `{field} = 'value'`, the only comparison the reads here need. */
export function fieldEquals(field: string, value: string): string {
  return `{${field}} = ${quote(value)}`
}

/**
 * `OR({field} = 'a', {field} = 'b')`, for asking about a set of text keys in one
 * request instead of one request per key.
 *
 * Used by the outbox enqueue to find which `idempotencyKey` values already exist.
 * An empty set would produce `OR()`, which Airtable rejects, so it answers `FALSE()`
 * instead: asking about nothing matches nothing, and a caller that has nothing to
 * ask about must not receive the whole table.
 *
 * Callers chunk their keys, because a formula travels in the query string and a few
 * hundred of them would exceed the URL length before Airtable ever saw it.
 */
export function anyFieldEquals(field: string, values: readonly string[]): string {
  if (values.length === 0) return 'FALSE()'
  return `OR(${values.map((value) => fieldEquals(field, value)).join(', ')})`
}
