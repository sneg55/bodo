// The Event Team read: an event's `EventMemberships` rows and the `AdminUsers` behind them.
//
// Two tables and one function, because the surface is a JOIN and either half alone answers
// nothing: the membership carries the role and the event, the user carries the name and the
// address. The join itself is NOT done here. It is `teamRows` in `features/team/members.ts`,
// so the scoping and the deleted-user case are unit tested without a base, and so this file
// keeps to what the DAL owns: pagination, tags, and the mapping that stops an Airtable field
// name leaking upwards.
//
// CACHING. Both lists are tagged `event:{id}` and given the long window, matching
// `liveMemberships` in `features/review/review-reads.ts`, which reads the same pair for the
// committee picker: granting somebody a role is an event change, and `event:{id}` is the tag
// that says so. Every write in mutations-team.ts expires it, plus the affected person's
// `user:{id}:memberships`, which is the capability lookup and the one that actually matters.
//
// WHY THERE IS AN UNCACHED TWIN. The write path decides create-versus-refuse from this read
// (an address already on the team must be refused, because Airtable has no unique
// constraint), and read-cache.ts states the rule for exactly that situation: a cached answer
// where a write branches on it is how one person ends up with two membership rows. Same
// decision, and the same shape, as `listEmailTemplatesUncached` in reads-comms.ts.

import { getClient } from '@/services/airtable/client'
import { FIXTURE_ADMINS, FIXTURE_MEMBERSHIPS } from '@/services/airtable/fixtures'
import { mapAdminUser, mapMembership } from '@/services/airtable/mapping-lookups'
import { REVALIDATE } from '@/services/airtable/read-cache'
import { TABLES } from '@/services/airtable/tables'
import { adminUsersTag, eventTag } from '@/services/airtable/tags'
import type { AdminUser, EventMembership } from '@/types/domain'
import { hasAirtable } from '@/utils/env'

export type EventTeamRecords = {
  /** Every membership row in the base. Filtering by event is `teamRows`. */
  readonly memberships: readonly EventMembership[]
  readonly users: readonly AdminUser[]
}

/**
 * The team, cached. What the page reads.
 *
 * Neither list can be filtered server side: an Airtable formula sees a linked record as its
 * primary field's TEXT, so `{event} = 'recABC'` matches nothing (reads.ts). Both paginate to
 * completion and the event filter is application code, which is why the whole pair is one
 * cache entry rather than one per event.
 */
export async function readEventTeam(eventId: string): Promise<EventTeamRecords> {
  return await readTeam(eventId, true)
}

/** The same read with no cache, for the write path. See the header. */
export async function readEventTeamUncached(eventId: string): Promise<EventTeamRecords> {
  return await readTeam(eventId, false)
}

async function readTeam(eventId: string, cached: boolean): Promise<EventTeamRecords> {
  // The no-credentials demo has to be able to show a team, the same way the committee picker
  // can. `eventId` is unused on this branch because the fixture base holds one event.
  if (!hasAirtable()) {
    void eventId
    return { memberships: FIXTURE_MEMBERSHIPS, users: FIXTURE_ADMINS }
  }

  const client = getClient()
  const [membershipRecords, userRecords] = await Promise.all([
    client.listAll(
      TABLES.eventMemberships,
      cached ? { tags: [eventTag(eventId)], revalidate: REVALIDATE.lookup } : undefined,
    ),
    // TWO tags, and the second is the load-bearing one. Both halves page a whole table and
    // filter in code, so the AdminUsers request is byte-identical for every event and the
    // Data Cache holds ONE entry for all of them, tagged with whichever event asked first.
    // A rename expiring only `event:{id}` would therefore miss it whenever some other
    // event's page had populated it. See `adminUsersTag` in tags.ts.
    client.listAll(
      TABLES.adminUsers,
      cached
        ? { tags: [eventTag(eventId), adminUsersTag()], revalidate: REVALIDATE.lookup }
        : undefined,
    ),
  ])

  return {
    memberships: membershipRecords.map(mapMembership),
    users: userRecords.map(mapAdminUser),
  }
}
