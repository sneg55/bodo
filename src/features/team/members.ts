// Event Team: the shape of one member row, and the three rules over the list.
//
// BUILD_SPEC 5.0b: "Event Team is real, not a placeholder... a table of members (name,
// email, role, added date), `+ Add Member` taking an email plus a role, which creates the
// AdminUsers row if absent, creates the membership, and sends a magic-link invite; a role
// select per row; and a Remove action."
//
// The rules live here rather than in the Server Action, for the reason
// `features/settings/lookups.ts` gives about the Tags duplicate check: they are expensive to
// debug through the UI and cheap to pin in a unit test, and a rule that decides who holds
// capability on an event should not only be exercised by clicking.
//
// A membership row IS the capability everywhere in this app (`requireEventRole` resolves it
// from `EventMemberships` on every request), so each rule below is stated as what it prevents:
//
//   `teamRows`             the list is a JOIN scoped to ONE event, so no other event's team
//                          can appear on this page or be edited from it.
//   `checkNewMemberEmail`  Airtable has NO unique constraint, so two membership rows for one
//                          person on one event is representable, and the guard would then
//                          resolve to whichever the pagination returned first.
//   `checkLastAdmin`       an event whose last admin is removed or demoted has nobody who can
//                          manage it, and nothing in this build can repair that.

import type { EventRole } from '@/constants/status'
import type { AdminUser, EventMembership, RecordId } from '@/types/domain'

/** One row of the table: the person, the role their membership carries, and when. */
export type TeamMember = {
  readonly membershipId: RecordId
  readonly userId: RecordId
  /** Blank when the AdminUsers row has no name, or has been deleted. */
  readonly name: string
  /** Blank only when the AdminUsers row has been deleted. See `teamRows`. */
  readonly email: string
  readonly role: EventRole
  /** ISO 8601 as Airtable stored it. Formatting is the component's business. */
  readonly addedAt: string
}

export type TeamProblem = { readonly message: string }

/** Airtable's email column, and the practical limit of a real address. */
export const MEMBER_EMAIL_MAX_LENGTH = 254

/** Labels for the role select and for every message, so the copy is spelled once. */
export const TEAM_ROLE_LABELS: ReadonlyMap<EventRole, string> = new Map([
  ['admin', 'Admin'],
  ['reviewer', 'Reviewer'],
])

export function teamRoleLabel(role: EventRole): string {
  return TEAM_ROLE_LABELS.get(role) ?? role
}

/**
 * The "Added" column, as `Feb 1, 2026`.
 *
 * Fixed to UTC rather than the event's timezone, and that is a decision rather than an
 * oversight: the value is an audit stamp with no schedule meaning, this page reads nothing
 * about the event, and pulling in the event record only to shift an audit date by a few hours
 * would add a read to every navigation. An unparseable or empty value renders as an em-dash
 * substitute rather than `Invalid Date`, because a row added directly in Airtable can have a
 * blank column and a broken cell would look like a broken page.
 */
export function formatAddedAt(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return '-'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed)
}

/**
 * The event's members, one row per membership, sorted the way the table renders them.
 *
 * Scoped to `eventId` HERE as well as in the read, because the read pages the whole
 * `EventMemberships` table (an Airtable formula cannot compare a linked record against a
 * record id, see reads.ts) and the filter is therefore application code either way.
 *
 * A membership whose AdminUsers row is missing is KEPT, with a blank name and email, and this
 * is the one place it differs from `listEventReviewers` in features/review/review-reads.ts,
 * which drops it. Two reasons, both specific to this surface. The row still grants a role on
 * every request, because `listMembershipsForUser` reads the membership and never the user, so
 * hiding it hides live capability from the only page that can revoke it. And it is what
 * `checkNewMemberEmail` compares against, so dropping it would let the same person be added
 * twice. The committee picker drops it for its own good reason: a blank checkbox there
 * assigns review work to nobody.
 */
export function teamRows(input: {
  memberships: readonly EventMembership[]
  users: readonly AdminUser[]
  eventId: RecordId
}): readonly TeamMember[] {
  const userById = new Map(input.users.map((user) => [user.id, user]))

  return input.memberships
    .filter((membership) => membership.eventId === input.eventId)
    .map((membership) => {
      const user = userById.get(membership.userId)
      return {
        membershipId: membership.id,
        userId: membership.userId,
        name: user?.name ?? '',
        email: user?.email ?? '',
        role: membership.role,
        addedAt: membership.addedAt,
      }
    })
    .sort((left, right) => sortKey(left).localeCompare(sortKey(right)))
}

/** Name if there is one, email otherwise: what the row actually shows first. */
function sortKey(member: TeamMember): string {
  return member.name.trim() === '' ? member.email : member.name
}

/** Trimmed and lowercased. What every comparison and every stored address uses. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * Enough of an address to be worth sending a sign-in link to.
 *
 * Deliberately not RFC 5322: a full grammar accepts quoted local parts nobody types and
 * still cannot tell a real mailbox from a plausible one. What this catches is the typo class
 * that produces a member who can never sign in: no `@`, nothing before or after it,
 * whitespace inside, or a domain with no dot.
 *
 * Written as splits rather than one pattern on purpose: the natural expression for
 * "at least two dot-separated labels" nests a quantifier inside a group, which is a
 * catastrophic-backtracking shape and is what `security/detect-unsafe-regex` exists to stop.
 * Splitting is linear and reads as the rule it enforces.
 */
const NOT_ALLOWED = /[\s@]/

export function isEmailLike(value: string): boolean {
  const parts = value.split('@')
  if (parts.length !== 2) return false

  const [local, domain] = parts
  if (local === '' || NOT_ALLOWED.test(local)) return false

  const labels = domain.split('.')
  return labels.length >= 2 && labels.every((label) => label !== '' && !NOT_ALLOWED.test(label))
}

/**
 * Whether an address may be added to this team.
 *
 * The duplicate answer is the important one and it is compared on the NORMALIZED address,
 * because `Sam@Example.com` and `sam@example.com` are one mailbox and would be two membership
 * rows. Follows `checkLookupName` in features/settings/lookups.ts, which refuses a duplicate
 * Tag name for the same reason: the base will happily hold both.
 */
export function checkNewMemberEmail(
  raw: string,
  existing: readonly TeamMember[],
): TeamProblem | undefined {
  const email = normalizeEmail(raw)

  if (email === '') return { message: 'Email address is required.' }
  if (email.length > MEMBER_EMAIL_MAX_LENGTH) {
    return { message: `That email address is too long (limit ${MEMBER_EMAIL_MAX_LENGTH}).` }
  }
  if (!isEmailLike(email)) return { message: `"${raw.trim()}" is not an email address.` }

  const clash = existing.some((member) => normalizeEmail(member.email) === email)
  return clash ? { message: `${email} is already on this team.` } : undefined
}

/**
 * Whether a change to one membership would leave the event with no admin.
 *
 * `nextRole` absent means the row is being REMOVED; present means its role is being changed.
 *
 * THE DECISION, stated here because it is the one judgement call on this surface: this is a
 * REFUSAL, not a warning, and it applies to any admin editing any admin rather than only to
 * somebody editing their own row. The lockout is identical either way, and it cannot be
 * undone from inside the product: a reviewer cannot open this page, there is no super-admin
 * surface in this build, and the only repair is editing `EventMemberships` in Airtable by
 * hand. A confirm-and-proceed dialog would trade a recoverable annoyance ("add a second admin
 * first") for an unrecoverable one, so the annoyance wins.
 *
 * It counts rows, not people. Two membership rows for the same admin would each count, which
 * is exactly why `checkNewMemberEmail` refuses the duplicate that creates them.
 */
export function checkLastAdmin(
  rows: readonly TeamMember[],
  membershipId: RecordId,
  nextRole?: EventRole,
): TeamProblem | undefined {
  const target = rows.find((row) => row.membershipId === membershipId)
  // Not on this event's list. Ownership is a separate check with its own error id, and
  // counting admins for a row that is not here would answer a question nobody asked.
  if (target === undefined || target.role !== 'admin') return undefined
  if (nextRole === 'admin') return undefined

  const otherAdmins = rows.filter(
    (row) => row.role === 'admin' && row.membershipId !== membershipId,
  ).length
  if (otherAdmins > 0) return undefined

  return {
    message:
      'This is the only admin on the event. Add another admin first, or nobody would be able to manage this event.',
  }
}
