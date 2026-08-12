// What one run has accumulated so far, and how the Needs-email list is settled.
//
// Split out of run.ts for the 300-line ceiling, along a real seam: run.ts owns the claim,
// the phase walk and the two outcome writes, and this owns the BOX those three pass
// between them. The box exists because the success path and the failure path both have to
// report what the earlier phases produced, and only one of them used to.

import type { ImportCounts, NeedsEmailRow } from '@/types/imports'

/**
 * What the run has accumulated so far, readable by the failure path.
 *
 * `derive` is the Needs-email list's rebuild, parked here because `advance` is the only
 * thing that can build a `PhaseContext` and `recordFailure` is where the list was being
 * lost. It is armed the moment the speakers phase is known to have run, in this invocation
 * or an earlier one, and left unset before that: an unset `derive` means "this run has not
 * looked for addresses yet", which is exactly the state that must not be reported as `[]`.
 */
export type RunProgress = {
  counts: ImportCounts
  needsEmail: readonly NeedsEmailRow[]
  derive?: () => Promise<readonly NeedsEmailRow[]>
}

/** The half of `RunProgress` a report carries. `derive` is machinery, not an outcome. */
export function reported(held: RunProgress): {
  counts: ImportCounts
  needsEmail: readonly NeedsEmailRow[]
} {
  return { counts: held.counts, needsEmail: held.needsEmail }
}

/**
 * Rebuild the Needs-email list if this run has reached the speakers phase, else leave it.
 *
 * Called from BOTH outcomes, and the failure path is the one this was written for. The
 * sequence that was losing the list: the speakers invocation reports an addressless
 * speaker, the next invocation's submissions phase throws, and THAT invocation's
 * `held.needsEmail` was seeded `[]` off the row, because the checkpoint persists phase and
 * counts only. The run was then written `failed` carrying no list at all. A failed run owes
 * the organizer that list at least as much as a finished one does: the speakers are in
 * bodo, they have no address, and nothing produces the list again.
 *
 * Assignment is unconditional once `derive` is armed, `[]` included. An empty list from an
 * armed derivation is a real answer ("every speaker this run touched has an address now"),
 * and the old `length > 0` guard could not say it: it existed only because the derivation
 * ran even before the speakers phase had, and arming is what replaced it.
 */
export async function settleNeedsEmail(held: RunProgress): Promise<void> {
  if (held.derive === undefined) return
  held.needsEmail = await held.derive()
}
