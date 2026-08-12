// Identity reads: the seam `src/features/auth` needs.
//
// Split out of reads.ts, which had grown past the line limit once each read started
// declaring its own cache tags. They sit in this directory rather than in the auth
// feature for the original reason: Airtable field names must not leak past here.
//
// Two of the three are UNCACHED, and that is the whole shape of this file. An account
// created seconds ago must be able to log in, and a negative answer held for an hour is
// a speaker locked out of their own portal. Only the capability lookup is cached, because
// it is read on essentially every admin request.

import { getClient } from '@/services/airtable/client'
import { mapSpeaker } from '@/services/airtable/mapping'
import { mapAdminUser, mapMembership } from '@/services/airtable/mapping-lookups'
import { REVALIDATE } from '@/services/airtable/read-cache'
import { findByText } from '@/services/airtable/reads'
import { COL, TABLES } from '@/services/airtable/tables'
import { userMembershipsTag } from '@/services/airtable/tags'
import type { AdminUser, EventMembership, Speaker } from '@/types/domain'

/**
 * Every membership for one user. Filtered in code for the same reason every other
 * link filter is: a formula compares a linked record against its primary field's
 * text, so `{user} = 'recUsr1'` matches nothing.
 *
 * Tagged per user, so one person's role change does not expire everybody else's
 * capability lookup, and given the long window because the row changes when a team is
 * edited and is read on every request until then.
 */
export async function listMembershipsForUser(userId: string): Promise<readonly EventMembership[]> {
  const records = await getClient().listAll(TABLES.eventMemberships, {
    tags: [userMembershipsTag(userId)],
    revalidate: REVALIDATE.lookup,
  })
  return records.map(mapMembership).filter((row) => row.userId === userId)
}

/**
 * Email lookups DO use a formula, because email is a real text column. Absent is a
 * normal answer, not an error: an unknown address on the login form must not be
 * distinguishable from a known one, or the page becomes an account enumerator.
 *
 * No cache argument, so no cache. See the header.
 */
export async function findAdminUserByEmail(email: string): Promise<AdminUser | undefined> {
  const record = await findByText(TABLES.adminUsers, COL.email, email)
  return record === undefined ? undefined : mapAdminUser(record)
}

export async function findSpeakerByEmail(email: string): Promise<Speaker | undefined> {
  const record = await findByText(TABLES.speakers, COL.email, email)
  return record === undefined ? undefined : mapSpeaker(record)
}
