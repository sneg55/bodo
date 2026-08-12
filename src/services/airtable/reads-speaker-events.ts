// Which events one speaker belongs to.
//
// This is the read that lets the portal stop being a single-event product. Every portal read
// used to be scoped by `portalEventId()`, which comes from configuration and names ONE event,
// so a speaker who submitted to a second event was shown nothing: the eval run of
// 2026-08-10 recorded a proposal filed through the public CFP that never appeared at
// /portal or /portal/submissions, while /portal/submissions/SESS-35 answered a genuine 404
// and the account menu offered no event switcher. The confirmation page had just told that
// person to track it there.
//
// The scope comes from the SPEAKER'S OWN RECORD, not from a list of every event in the base.
// Two reasons, and the second is the load-bearing one:
//
//   1. It is one record read instead of a table scan.
//   2. It is authorization, not just filtering. The events a speaker is linked to are
//      exactly the events they may be shown, so a portal read scoped to this set cannot
//      widen into somebody else's conference by accident. A base-wide event list would put
//      the burden of narrowing on every caller, and one caller forgetting is a leak.
//
// Tagged `speaker:{id}`, which is the tag every write that links a speaker to an event
// already expires (`mutations-speakers.ts`, `mutations-participants.ts`). A speaker's first
// submission to a new event therefore shows up on their next portal load rather than after a
// revalidation window.

import { getClient } from '@/services/airtable/client'
import { speakerEventIds } from '@/services/airtable/mapping'
import { REVALIDATE } from '@/services/airtable/read-cache'
import { TABLES } from '@/services/airtable/tables'
import { speakerTag } from '@/services/airtable/tags'
import { hasAirtable } from '@/utils/env'

export async function listEventIdsForSpeaker(speakerId: string): Promise<readonly string[]> {
  // The fixture branch. Without it `getClient()` throws on a clone with an empty `.env`,
  // and because `portalEventIds()` calls this before anything renders, that took out the
  // WHOLE speaker portal rather than one card. Returning no ids lets the caller fall back
  // to the configured event, which is what the portal did before it learned about several.
  if (!hasAirtable()) return []
  const record = await getClient().getRecord(TABLES.speakers, speakerId, {
    tags: [speakerTag(speakerId)],
    revalidate: REVALIDATE.edited,
  })
  return speakerEventIds(record)
}
