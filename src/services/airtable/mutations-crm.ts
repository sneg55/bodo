// Writes for the speaker CRM: the tag vocabulary, tag membership, and saved lists.
//
// Split from mutations.ts for the line limit, same as mutations-review.ts and
// mutations-outbox.ts. The speaker CSV import writes are a second split, in
// mutations-crm-import.ts, because the two together were still over budget; `chunkForAirtable`
// lives here rather than there because a fixed test path imports it from this file.
//
// Every write ends by calling invalidate.ts, which owns what expiry means, and each one
// names exactly the tags it affects: BUILD_SPEC 6.1 treats over-invalidation as a real
// defect, not a style nit, because a single CRM-wide tag would mean tagging one speaker
// expires the whole directory for every organizer.

import type { DataTableFilter } from '@/components/primitives/data-table-types'
import { chunk, getClient, MAX_BATCH, type RecordPatch } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import {
  mapSpeakerList,
  mapSpeakerTag,
  speakerTagSpeakerIds,
} from '@/services/airtable/mapping-crm'
import { onlyRecord } from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import {
  sharedSpeakerListsTag,
  speakerTag,
  speakerTagsTag,
  userSpeakerListsTag,
} from '@/services/airtable/tags'
import { compact, link } from '@/services/airtable/to-fields'
import type { RecordId, SpeakerList, SpeakerTag } from '@/types/domain'

/**
 * Split into batches of `MAX_BATCH`, which is Airtable's write ceiling per request
 * (client.ts). A thin wrapper over the client's own `chunk`, not a second
 * implementation of it, so the 10-record rule is spelled in exactly one place.
 */
export function chunkForAirtable<T>(items: readonly T[]): readonly (readonly T[])[] {
  return chunk(items, MAX_BATCH)
}

/**
 * `try`/`finally` for the reason `saveSpeakerProfile` documents in mutations-speakers.ts:
 * `onlyRecord` throws on a 200 with an empty `records` array, and the tag it cannot name has
 * still been created, so the vocabulary every tag picker reads has to be expired anyway.
 * `finally` does not catch, so the failure still reaches the caller rather than being
 * reported as a saved tag. `createRecords` stays outside: a rejected request wrote nothing.
 */
export async function createSpeakerTag(
  origin: WriteOrigin,
  input: { name: string; color: string },
): Promise<SpeakerTag> {
  const created = await getClient().createRecords(TABLES.speakerTags, [
    compact({ [COL.name]: input.name, [COL.color]: input.color }),
  ])
  try {
    return mapSpeakerTag(onlyRecord(created, TABLES.speakerTags))
  } finally {
    invalidate(origin, { own: [speakerTagsTag()] })
  }
}

/**
 * Replace one speaker's tag membership with `tagIds`.
 *
 * The tag vocabulary is read UNCACHED, not through `listSpeakerTags` (`REVALIDATE.lookup`,
 * up to an hour stale): this write replaces the whole `speakers` link on every row it
 * touches, so deciding what to write from an hour-old snapshot would silently drop another
 * organizer's concurrent tagging change on the row this one does not intend to touch.
 *
 * `patches` is unbounded here, and `client.updateRecords` chunks it into requests of ten
 * internally, so more than ten changed tags is more than one HTTP request. The `try`/
 * `finally` around that write is what stops a later request's failure from leaving the
 * earlier ones' changes uninvalidated: without it, the first ten rows land in Airtable but
 * the function throws before reaching `invalidate`, and every cached read of the tag
 * vocabulary keeps serving the membership from before any of it happened.
 */
export async function setSpeakerTags(
  origin: WriteOrigin,
  speakerId: RecordId,
  tagIds: readonly string[],
): Promise<void> {
  const client = getClient()
  const desired = new Set(tagIds)
  const records = await client.listAll(TABLES.speakerTags)

  const patches: RecordPatch[] = []
  for (const record of records) {
    const current = speakerTagSpeakerIds(record)
    const shouldHave = desired.has(record.id)
    const has = current.includes(speakerId)
    if (shouldHave === has) continue
    const next = shouldHave ? [...current, speakerId] : current.filter((id) => id !== speakerId)
    patches.push({ id: record.id, fields: { [COL.speakers]: next } })
  }

  try {
    if (patches.length > 0) {
      await client.updateRecords(TABLES.speakerTags, patches)
    }
  } finally {
    invalidate(origin, { own: [speakerTagsTag(), speakerTag(speakerId)] })
  }
}

export type SpeakerListInput = {
  id?: string
  name: string
  ownerId: string
  isShared: boolean
  filters: readonly DataTableFilter[]
}

export async function saveSpeakerList(
  origin: WriteOrigin,
  input: SpeakerListInput,
): Promise<SpeakerList> {
  const client = getClient()
  const fields = compact({
    [COL.name]: input.name,
    [COL.owner]: link(input.ownerId),
    [COL.isShared]: input.isShared,
    [COL.definitionJson]: JSON.stringify(input.filters),
  })

  const written =
    input.id === undefined
      ? await client.createRecords(TABLES.speakerLists, [fields])
      : await client.updateRecords(TABLES.speakerLists, [{ id: input.id, fields }])

  // `try`/`finally`, same shape as `createSpeakerTag` above: `onlyRecord` throws on a 200
  // with an empty `records` array, and the list it cannot name has still been written, so
  // the tags below would otherwise expire nothing while the row sat in Airtable. Both
  // tags are known from `input`, so the throw costs this invalidation no precision, and
  // because `finally` does not catch, it still reaches the caller.
  try {
    return mapSpeakerList(onlyRecord(written, TABLES.speakerLists))
  } finally {
    // Both tags, unconditionally: see sharedSpeakerListsTag's doc in tags.ts. A save that
    // just turned isShared on has to expire the tag other users read through; one that just
    // turned it off has to expire the tag it is LEAVING too, and there is no cheaper way to
    // know which without reading the row back.
    invalidate(origin, { own: [userSpeakerListsTag(input.ownerId), sharedSpeakerListsTag()] })
  }
}

/**
 * `ownerId` names which cache entry to expire, not a permission check: like every other
 * mutation in this directory, authorization is the calling Server Action's job (see
 * bodo-conventions.md), not the DAL's. A caller that has not verified the list belongs to
 * `ownerId` has a bug in the Server Action, not something this function can catch.
 */
export async function deleteSpeakerList(
  origin: WriteOrigin,
  listId: RecordId,
  ownerId: RecordId,
): Promise<void> {
  await getClient().deleteRecords(TABLES.speakerLists, [listId])
  // Both tags, unconditionally: the row is gone, so its isShared value cannot be read back
  // to decide whether sharedSpeakerListsTag matters here. See tags.ts.
  invalidate(origin, { own: [userSpeakerListsTag(ownerId), sharedSpeakerListsTag()] })
}

// The speaker CSV import (`upsertSpeakersBatch` and its row types) lives in
// mutations-crm-import.ts, a one-way import of `chunkForAirtable` from this file. Not
// re-exported back from here: that would be a dependency cycle between the two.
