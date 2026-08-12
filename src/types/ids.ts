// The one identifier alias every entity type is built out of.
//
// Its own file so that `types/review.ts` can import it without importing `domain.ts`,
// which re-exports `types/review.ts`. Types are erased, so the cycle would compile,
// but a cycle nothing needs is a cycle worth not having.

/** An Airtable record id (`rec...`). Aliased for readability, not branded. */
export type RecordId = string
