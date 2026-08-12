// The two input checks rules 2 and 3 of ./team-write.ts name, plus the refusal shape they
// and the writes share.
//
// Split out of team-write.ts when a fourth write pushed that file past the size budget.
// They belong together: both turn a value that arrived from a browser into one the writes
// are allowed to act on, and both raise rather than returning a flag, so the caller cannot
// carry on with an unchecked id or an unrecognised role.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { EVENT_ROLES, type EventRole } from '@/constants/status'
import type { TeamMember } from '@/features/team/members'
import type { RecordId } from '@/types/domain'

/** Rule 3. `EVENT_ROLES` is the closed list; anything else is refused, not coerced. */
export function assertRole(value: string, eventId: RecordId): EventRole {
  const role = EVENT_ROLES.find((known) => known === value)
  if (role === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, `"${value}" is not a role on an event`, {
      value,
      eventId,
      allowed: [...EVENT_ROLES],
    })
  }
  return role
}

/**
 * Rule 2. The membership has to be one of the AUTHORIZED event's own rows.
 *
 * `DATA_RECORD_NOT_FOUND` rather than a role error, and the same answer whether the id
 * belongs to another event or to nothing at all: an admin of event A must not be able to
 * learn that a record id is a live membership somewhere else.
 */
export function assertOnEvent(
  rows: readonly TeamMember[],
  input: { eventId: RecordId; membershipId: RecordId },
): TeamMember {
  const target = rows.find((row) => row.membershipId === input.membershipId)
  if (target === undefined) {
    throw new AppError(
      ErrorIds.DATA_RECORD_NOT_FOUND,
      'that team member is not on this event',
      input,
    )
  }
  return target
}

/** A refusal the organizer can act on, in the shape the Tags CRUD uses for the same job. */
export function refuse(message: string, context: Record<string, unknown>): AppError {
  return new AppError(ErrorIds.DATA_WRITE_FAIL, message, context)
}
