// Which of two speaker records sharing one normalized email is THE record for that email.
//
// A FILE WITH NO IMPORTS, and that is the reason it is a file. The rule has two callers by
// design - `loadSpeakersByEmail` on the write side and `findDuplicates` on the preview side -
// and the preview side is reachable from a `'use client'` component: `ImportWizard` imports
// `findDuplicates` from `features/crm/import/dedup.ts` for the offline repeat scan it falls
// back to when the server check cannot run.
//
// While this function lived in `mutations-crm-import-plan.ts`, importing it as a runtime value
// dragged that module's `getClient` import into the same graph, and with it `client.ts`,
// `scheduler.ts`, `records.ts`, `tables.ts` and `utils/env.ts`. Whether a bundler elides all
// that is a question about tree shaking (this package declares no `sideEffects` field), and
// the fix is to make the question unaskable rather than to answer it: a leaf module pulls in
// nothing, so nothing can come with it.
//
// So: no imports here, not even types. Anything added to this file has to keep that true.

/**
 * Airtable enforces no uniqueness on the Email column, so the collision is a real state and
 * something has to break the tie. This used to be "whichever came last out of `listAll`",
 * which is not a rule at all: it makes the answer depend on the order a caller happened to
 * read in, so the import preview (working from a sorted directory list) and the import write
 * (working from `listAll`) could name different records for the same pair and nothing would
 * report the disagreement.
 *
 * Greatest record id is arbitrary. That is fine, and it is not the point: no basis for
 * preferring one duplicate over another exists in the data, and `AirtableRecord` carries no
 * created time to appeal to. The point is that it depends only on the SET, so every caller
 * that holds the same two records agrees, whatever order they hold them in.
 */
export function winsEmailTie(incumbentId: string | undefined, candidateId: string): boolean {
  return incumbentId === undefined || candidateId > incumbentId
}
