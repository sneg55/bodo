// The Event Team page's read, and the write path's version of the same read.
//
// Both are the DAL's two-table read (`reads-team.ts`) joined by `teamRows`, which is the pure
// function that owns the scoping and the deleted-user case. Nothing here does any work of its
// own; it exists so the page and the actions name one function instead of repeating a join,
// and so which of the two cache decisions applies is stated at the call site rather than
// guessed.

import { type TeamMember, teamRows } from '@/features/team/members'
import { readEventTeam, readEventTeamUncached } from '@/services/airtable/reads-team'

/** The event's members, from the cached read. What the page renders. */
export async function readTeamMembers(eventId: string): Promise<readonly TeamMember[]> {
  const { memberships, users } = await readEventTeam(eventId)
  return teamRows({ memberships, users, eventId })
}

/**
 * The same list, uncached, for a write that branches on it.
 *
 * The duplicate refusal and the last-admin rule are both decided from this, and a cached
 * answer there is how a second membership row gets created for somebody who already has one.
 * See the header of reads-team.ts.
 */
export async function readTeamMembersForWrite(eventId: string): Promise<readonly TeamMember[]> {
  const { memberships, users } = await readEventTeamUncached(eventId)
  return teamRows({ memberships, users, eventId })
}
