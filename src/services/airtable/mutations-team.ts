// Writes to `AdminUsers` and `EventMemberships`: the Event Team surface's four mutations.
//
// These are the first writes to either table outside `scripts/seed`, which is why there was
// no way to add a second admin to an event until now (BUILD_SPEC 10, step 3).
//
// WHAT EACH WRITE HAS TO EXPIRE, because this is the one place in the DAL where getting
// invalidation wrong is a SECURITY bug rather than a stale screen:
//
//   `user:{id}:memberships`  is what `listMembershipsForUser` subscribes to
//                            (reads-identity.ts), and that read is the capability lookup
//                            `requireEventRole` performs on every request. It carries
//                            `REVALIDATE.lookup`, one hour. So a role change or a removal
//                            that does not expire it leaves the old capability live for up
//                            to an hour: a removed reviewer keeps reading the event, and a
//                            demoted admin keeps writing to it. Named by all three
//                            membership writes, and it is the reason the tag exists.
//   `event:{id}`             is what the team page and the committee picker read
//                            (reads-team.ts, review-reads.ts `liveMemberships`).
//
// And what they deliberately do NOT expire: the submissions list, the agenda, the review
// graph, the forms. A role change touches no submission row, and invalidating widely costs
// every screen in the product while invalidating narrowly costs one Airtable request
// (BUILD_SPEC 6.1). `event:{id}:review` in particular stays valid: reviews and assignments
// are their own rows and none of them changed.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { EventRole } from '@/constants/status'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import type { FieldSet } from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import { adminUsersTag, eventTag, userMembershipsTag } from '@/services/airtable/tags'
import { compact, link } from '@/services/airtable/to-fields'
import type { EventMembership, RecordId } from '@/types/domain'

/**
 * The `AdminUsers` row for an address that has none.
 *
 * `eventId` is taken only to say which event's cached team read this affects: the row shows up
 * in `readEventTeam`, which is tagged `event:{id}`. The membership write that follows expires
 * the same tag, so this is belt and braces rather than the load-bearing invalidation, and it
 * is here because a write that expires nothing is the shape of a bug (BUILD_SPEC 6.1).
 *
 * No name column is written. Nothing on this surface asks for one, the person supplies it
 * on `/admin/{eventId}/profile`, and inventing "New Member" would put a placeholder in
 * front of every organizer who ever reads the team table.
 */
export async function createAdminUser(
  input: { eventId: RecordId; email: string },
  origin: WriteOrigin = 'action',
): Promise<RecordId> {
  const created = await getClient().createRecords(TABLES.adminUsers, [
    compact({ [COL.email]: input.email }),
  ])
  const record = created.at(0)
  if (record === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'AdminUsers: write returned no record', input)
  }

  invalidate(origin, { own: [eventTag(input.eventId), adminUsersTag()] })
  return record.id
}

/**
 * Set the acting user's own display name. The only write to `AdminUsers` after creation.
 *
 * Until this existed the column was write-once-and-never, so the name every admin surface
 * shows (`actingUser`, the Event Team table, the committee picker) could only be filled in
 * by editing the base by hand. An invited member's row is created with an address and
 * nothing else, which is why they all read "No name yet".
 *
 * `eventIds` is EVERY event the user is a member of, resolved by the caller from their own
 * memberships, and it is not optional in practice: `readEventTeam` is tagged per event, so
 * a rename that expired only the event the person happened to be looking at would leave
 * their old name on every other event's team page for the full hour window. `adminUsersTag`
 * covers the shared cache entry the users half of that read actually lands in; the event
 * tags cover the memberships half and any read that joins the two.
 *
 * A BLANK name is a legitimate value and is written through, not refused: it clears the
 * column and the surfaces fall back to the address, which is the state every row starts in.
 */
export async function updateAdminUserName(
  input: { userId: RecordId; name: string; eventIds: readonly RecordId[] },
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().updateRecords(TABLES.adminUsers, [
    // Not `compact`: that drops empty values, and dropping the name is exactly how a
    // clear would silently do nothing.
    { id: input.userId, fields: { [COL.name]: input.name } },
  ])

  invalidate(origin, {
    own: [adminUsersTag(), ...new Set(input.eventIds.map(eventTag))],
  })
}

export type MembershipDraft = {
  eventId: RecordId
  userId: RecordId
  role: EventRole
  /** ISO 8601. Stamped by the caller so the write is testable. */
  addedAt: string
}

function membershipFields(draft: MembershipDraft): FieldSet {
  return compact({
    [COL.event]: link(draft.eventId),
    [COL.user]: link(draft.userId),
    [COL.role]: draft.role,
    [COL.addedAt]: draft.addedAt,
  })
}

/**
 * Grant a role on an event.
 *
 * Returns the mapped row rather than the record id, because the caller hands it straight back
 * to the UI as a table row and re-reading it would be a second request for data this write
 * already knows. The id comes off the created record; everything else is the draft, which is
 * what was actually sent.
 */
export async function createEventMembership(
  draft: MembershipDraft,
  origin: WriteOrigin = 'action',
): Promise<EventMembership> {
  const created = await getClient().createRecords(TABLES.eventMemberships, [
    membershipFields(draft),
  ])
  const record = created.at(0)
  if (record === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'EventMemberships: write returned no record', {
      eventId: draft.eventId,
      userId: draft.userId,
    })
  }

  invalidate(origin, {
    own: [eventTag(draft.eventId)],
    // The new member's own capability lookup. Theirs, not the acting admin's.
    others: [userMembershipsTag(draft.userId)],
  })
  return { id: record.id, ...draft }
}

export type MembershipScope = {
  membershipId: RecordId
  /** The event the caller was authorized on, and the row was checked against. */
  eventId: RecordId
  /** Read off the row, never from the client: it selects the tag to expire. */
  userId: RecordId
}

export async function updateMembershipRole(
  change: MembershipScope & { role: EventRole },
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().updateRecords(TABLES.eventMemberships, [
    { id: change.membershipId, fields: { [COL.role]: change.role } },
  ])
  invalidate(origin, {
    own: [eventTag(change.eventId)],
    others: [userMembershipsTag(change.userId)],
  })
}

/**
 * Revoke a role.
 *
 * Deletes the membership row and NOT the `AdminUsers` row, which is the honest boundary: the
 * person still exists, may hold a role on another event, and is linked from every review and
 * assignment they have ever written. Deleting the account would blank those links, and
 * Airtable would do it silently.
 */
export async function deleteEventMembership(
  scope: MembershipScope,
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().deleteRecords(TABLES.eventMemberships, [scope.membershipId])
  invalidate(origin, {
    own: [eventTag(scope.eventId)],
    // Immediately, or the removed member keeps their capability until the hour is up.
    others: [userMembershipsTag(scope.userId)],
  })
}
