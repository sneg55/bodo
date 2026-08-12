// What a merge does to the ABSTRACTS a merged speaker owns, and to a link cell holding more
// than one id.
//
// Both are here rather than in crm-merge-orchestration.test.ts because that file is at its
// size limit, and both need shapes the shared fixture deliberately does not have: a submission
// on an event no speaker row names, and a two-id link cell. `initialStore()` is spread rather
// than re-declared, which is what the helper was extracted for.
//
// The stakes on the first one are not "a stale list". `Submissions.submitter` was missing from
// the relink list, so a merge deleted the speaker, Airtable CLEARED the link cell on every
// abstract they had submitted, and `mapSubmission` reads that column with `requiredLink` while
// `listSubmissionsForEvents` maps the whole table before filtering by event. One merge broke
// every submissions read in every event, permanently.

import { describe, expect, it, vi } from 'vitest'

import { BYSTANDER, DUP_A, DUP_B, initialStore, PRIMARY, runMerge } from './helpers/merge-world'

const revalidateTag = vi.hoisted(() => vi.fn())

vi.mock('next/cache', () => ({ revalidateTag }))

/**
 * The shared base, plus the two shapes this file is about.
 *
 * `sub4` sits on `e7`, which is on NO speaker row: a submission's event link and a speaker's
 * event links are separate cells and nothing in Airtable couples them, so the merge's event
 * union cannot be relied on to name it.
 *
 * `recF1` holds two ids, which the product never writes but Airtable permits: every link is
 * created as `multipleRecordLinks` (001-initial-schema.ts), so a cell edited by hand can carry
 * a second id that a wholesale replace would drop.
 */
function store() {
  const base = initialStore()
  return {
    ...base,
    Submissions: [
      ...base.Submissions,
      { id: 'sub4', fields: { event: ['e7'], title: 'Outside the union', submitter: [DUP_B] } },
    ],
    Files: [{ id: 'recF1', fields: { speaker: [DUP_A, BYSTANDER] } }],
  }
}

describe('a merge, on the abstracts the absorbed speakers owned', () => {
  it('repoints the submitter and leaves somebody else alone', async () => {
    const world = await runMerge({ revalidateTag, store: store() })

    expect(world.fields('Submissions', 'sub1')?.submitter).toEqual([PRIMARY])
    expect(world.fields('Submissions', 'sub2')?.submitter).toEqual([PRIMARY])
    expect(world.fields('Submissions', 'sub4')?.submitter).toEqual([PRIMARY])
    expect(world.fields('Submissions', 'sub3')?.submitter).toEqual([BYSTANDER])
  })

  it('expires each repointed abstract by its own tag', async () => {
    // `getSubmission` caches under `submission:{id}` and nothing about a speaker names it, so
    // the per-speaker and per-event tags a merge already expires do not reach it. This is the
    // same tag `setPrimaryParticipant` expires when it writes the same column.
    const world = await runMerge({ revalidateTag, store: store() })

    expect(world.tags).toContain('submission:sub1')
    expect(world.tags).toContain('submission:sub2')
    expect(world.tags).toContain('submission:sub4')
    // Untouched, so expiring it would be the over-invalidation BUILD_SPEC 6.1 calls a defect.
    expect(world.tags).not.toContain('submission:sub3')
  })

  it('expires the list of an event the speaker rows never named', async () => {
    const world = await runMerge({ revalidateTag, store: store() })

    expect(world.tags).toContain('event:e7:submissions')
  })
})

describe('a merge, on the events a repointed row belongs to', () => {
  it('reads a comms row event as a comms tag, not as a submissions one', async () => {
    // EmailOutbox carries an `event` link as well, so a rule that turned every event id a
    // repoint saw into `event:{id}:submissions` would expire the wrong list here and leave
    // the right one stale. Over-invalidation is a defect in its own right (BUILD_SPEC 6.1).
    const world = await runMerge({
      revalidateTag,
      store: {
        ...store(),
        EmailOutbox: [{ id: 'recO1', fields: { event: ['e8'], speaker: [DUP_B] } }],
      },
    })

    expect(world.tags).toContain('event:e8:outbox')
    expect(world.tags).not.toContain('event:e8:submissions')
  })

  it('expires the rows it was about to write even when that write fails', async () => {
    // The repoint is reported BEFORE the request, because `updateRecords` batches at ten and a
    // later batch can fail after an earlier one landed. Expiring a row that turned out not to
    // move costs a refetch; not expiring one that did move serves stale data forever.
    const world = await runMerge({
      revalidateTag,
      store: store(),
      failAfter: { table: 'Submissions', afterWrites: 0, status: 401 },
    })

    expect(world.error).toBeDefined()
    expect(world.tags).toContain('submission:sub1')
  })
})

describe('a merge, on a link cell holding more than one id', () => {
  it('swaps the absorbed id and keeps the one that has nothing to do with the merge', async () => {
    const world = await runMerge({ revalidateTag, store: store() })

    expect(world.fields('Files', 'recF1')?.speaker).toEqual([PRIMARY, BYSTANDER])
  })
})
