// Live reads for Files.
//
// Split out of reads-portal.ts when the event-scoped read below was added and that file
// passed the size budget. It is a clean seam: the Files table is the one table here that
// has NO event link, so every read of it is a full listing filtered in code, and the three
// readers differ only in which link they compare.
//
// The same "filter in code, not in a formula" rule applies as everywhere else in this DAL,
// and it applies hardest here: speaker and submission are both LINK columns, which
// Airtable's formula language cannot compare by record id (see formula.ts).
//
// Every read that a PAGE renders declares its tags and its window; there is no uncached
// Files read, because no write decides its invalidation from one.

import { getClient } from '@/services/airtable/client'
import { mapFile } from '@/services/airtable/mapping-portal'
import { REVALIDATE, type ReadCache } from '@/services/airtable/read-cache'
import { TABLES } from '@/services/airtable/tables'
import { eventFilesTag, speakerFilesTag, submissionFilesTag } from '@/services/airtable/tags'
import type { StoredFile } from '@/types/domain'

/**
 * Files matching a predicate, newest upload first.
 *
 * One helper for all three reads rather than three near-identical bodies, because the only
 * thing that differs is which link is compared.
 */
async function listFilesWhere(
  cache: ReadCache,
  keep: (file: StoredFile) => boolean,
): Promise<readonly StoredFile[]> {
  const records = await getClient().listAll(TABLES.files, cache)
  return records
    .map(mapFile)
    .filter(keep)
    .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt))
}

export async function listFilesForSpeaker(speakerId: string): Promise<readonly StoredFile[]> {
  return await listFilesWhere(
    { tags: [speakerFilesTag(speakerId)], revalidate: REVALIDATE.edited },
    (file) => file.speakerId === speakerId,
  )
}

export async function listFilesForSubmission(submissionId: string): Promise<readonly StoredFile[]> {
  return await listFilesWhere(
    { tags: [submissionFilesTag(submissionId)], revalidate: REVALIDATE.edited },
    (file) => file.submissionId === submissionId,
  )
}

/**
 * Every file owned by a set of speakers: the two admin Files lists.
 *
 * The speaker ids come from the caller because event scope cannot come from anywhere else.
 * `features/bundle/reads.ts` records why at length, and states the cost this read removes:
 * with no event-scoped listing, the bundle pays one listing PER SESSION and bounds itself
 * at fifty to keep that affordable. This costs the same single listing as its two
 * neighbours, since `listAll` already reads the whole table and filters in memory, so
 * scoping by four hundred speakers is no more expensive than scoping by one.
 *
 * `eventId` names the tag and nothing else. No Files row records an event.
 */
export async function listFilesForEventSpeakers(
  eventId: string,
  speakerIds: readonly string[],
): Promise<readonly StoredFile[]> {
  const owners = new Set(speakerIds)
  return await listFilesWhere(
    { tags: [eventFilesTag(eventId)], revalidate: REVALIDATE.edited },
    (file) => owners.has(file.speakerId),
  )
}
