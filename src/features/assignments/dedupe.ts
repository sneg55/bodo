// One rule for folding duplicate assignment rows, shared by every surface that reads them.
//
// Airtable has no unique constraint, so two rows CAN describe the same to-do: two concurrent
// Assign presses, or a row somebody added by hand. That is not the bug. The bug is what
// happened twice in this codebase when each surface decided for itself: tasks had three
// readers that deduplicated three different ways, and File Requests then repeated it from the
// same template. In both cases the visible symptom was the same and it is the worst kind,
// because nothing errors: the admin side reported a speaker COMPLETE off one row while the
// speaker's own portal still listed the other as outstanding, and a count read 0/1 or 1/1 for
// identical data depending on the order Airtable happened to return.
//
// So the rule lives here once, next to `planFanout`, which is the writer that these are the
// readers of. Both callers pass their own key and their own notion of "finished", because a
// task is `done` and a file request is `received`, and neither should have to know about the
// other.
//
// FINISHED WINS. The speaker did the thing, and chasing somebody for work they already
// delivered is the worse failure on surfaces whose entire purpose is deciding who to chase.

/**
 * One entry per tuple, preferring a finished row.
 *
 * Insertion-ordered on first sight of each tuple, so a caller that relies on the order its
 * rows arrived in keeps it.
 */
export function dedupeByTuple<T>(
  items: readonly T[],
  key: (item: T) => string,
  isFinished: (item: T) => boolean,
): readonly T[] {
  const byTuple = new Map<string, T>()

  for (const item of items) {
    const existing = byTuple.get(key(item))
    if (existing === undefined || (!isFinished(existing) && isFinished(item))) {
      byTuple.set(key(item), item)
    }
  }

  return [...byTuple.values()]
}
