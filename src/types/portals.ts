// Portals: the per-event containers a contact is assigned to, and the filters that
// decide which one. BUILD_SPEC 5.0c.
//
// Its own file rather than more of types/resources.ts, which owns `PortalItem` and is
// read by the resources feature alone. These types are read by the portal-config
// feature, the speaker portal, and their DAL slice, and domain.ts is at its line limit.
//
// The one structural fact everything here follows from: an event has MANY portals, one
// of them default, and membership is assigned BY FILTER rather than by hand. The vendor
// states the tie-break explicitly ("the contact will be assigned to the first portal in
// the list that they qualify for, based on the order of the portals"), so `order` is
// load-bearing rather than cosmetic and a tie is a correctness bug, not a display one.

import type { RecordId } from '@/types/domain'

/**
 * Contacts portals are the only kind bodo writes.
 *
 * `groups` is in the vocabulary because it is in the vendor's, and because a column that
 * can only ever hold one value stops being a column the moment somebody adds the
 * sponsors module. Nothing in this codebase writes it: the group-type tiles §5.0b renders
 * are disabled, and the module behind them is on the waiver list.
 */
export const PORTAL_KINDS = ['contacts', 'groups'] as const
export type PortalKind = (typeof PORTAL_KINDS)[number]

/**
 * The contact types a portal can target, mapped onto what this schema actually carries.
 *
 * The first four are `PARTICIPANT_ROLES` verbatim (constants/status.ts), so the picker is
 * real rather than aspirational. `submitter` is the fifth the help centre names and it is
 * NOT a participant role: it is `Submissions.submitter`, the account that owns the draft,
 * which is a different question from who is presenting. Sponsor and Exhibitor Individual
 * Contacts are absent for the same reason `groups` is never written.
 */
export const PORTAL_CONTACT_TYPES = [
  'speaker',
  'co_speaker',
  'moderator',
  'chairperson',
  'submitter',
] as const
export type PortalContactType = (typeof PORTAL_CONTACT_TYPES)[number]

/**
 * What a filter rule can test.
 *
 * Two families, and the split is not cosmetic: a CONTACT field is a property of the person
 * and answers directly, while a SESSION field is a property of their submissions and
 * therefore matches when ANY of them does. A speaker with three sessions on three tracks
 * qualifies for a track filter naming any one of them, which is the only reading that does
 * not silently exclude the busiest people at the conference.
 */
export const PORTAL_CONTACT_FILTER_FIELDS = ['role', 'company'] as const
export const PORTAL_SESSION_FILTER_FIELDS = ['format', 'track', 'tag', 'level', 'language'] as const
export const PORTAL_FILTER_FIELDS = [
  ...PORTAL_CONTACT_FILTER_FIELDS,
  ...PORTAL_SESSION_FILTER_FIELDS,
] as const
export type PortalFilterField = (typeof PORTAL_FILTER_FIELDS)[number]

/** `is_not` is a real requirement: "everyone except the keynote track" is one rule, not five. */
export const PORTAL_FILTER_OPERATORS = ['is', 'is_not'] as const
export type PortalFilterOperator = (typeof PORTAL_FILTER_OPERATORS)[number]

/**
 * One predicate.
 *
 * `values` is a set the rule matches ANY of, so "Track is Platform or Security" is one
 * rule rather than two. An empty `values` matches NOTHING rather than everything, and
 * that choice is the safe one in both directions: a half-built rule excludes people from
 * a custom portal, and everyone excluded lands on the default, which is where they would
 * have been anyway.
 *
 * Link-typed fields (`track`, `tag`) carry RECORD IDS in `values`, not names. A name
 * changes when an organizer renames a track and the rule would silently stop matching;
 * an id does not.
 */
export type PortalFilterRule = {
  field: PortalFilterField
  operator: PortalFilterOperator
  values: readonly string[]
}

/**
 * The whole of `Portals.filterJson`.
 *
 * Rules are ANDed. An OR across two different fields is not expressible and deliberately
 * so: it is a second portal, which is the mechanism this feature already has, and one
 * portal whose membership needs a boolean tree is a rule nobody can debug from the list
 * screen.
 *
 * `contactTypes` is separate from `rules` rather than a sixth rule field because it is the
 * portal's TYPE question ("who is this for") and the create wizard asks it on step one,
 * before any filtering. An empty list means every contact type, which is what the default
 * portal carries.
 */
export type PortalFilters = {
  contactTypes: readonly PortalContactType[]
  rules: readonly PortalFilterRule[]
}

export const EMPTY_PORTAL_FILTERS: PortalFilters = { contactTypes: [], rules: [] }

/**
 * One portal.
 *
 * `isDefault` is a checkbox rather than a nullable link on Events because exactly one row
 * per event carries it and the write path is what enforces that (`savePortal` refuses a
 * save that would leave an event with none or two). It is created with the event so a
 * contact matching no filter can never have nowhere to land.
 *
 * `order` is dense-renumbered from 0 on every save. A tie here is not a display glitch:
 * first match wins, so two portals sharing a number make a contact's portal depend on the
 * order Airtable happened to paginate them in.
 */
export type Portal = {
  id: RecordId
  eventId: RecordId
  name: string
  kind: PortalKind
  isDefault: boolean
  order: number
  filters: PortalFilters
  welcomeMessage?: string
  /** Show the Tasks section even when the speaker has none assigned. Vendor label. */
  alwaysShowTasks: boolean
  /** Let the speaker edit their own profile from this portal. Vendor label. */
  manageProfile: boolean
}

/**
 * One contact, flattened into exactly what a filter can test.
 *
 * A projection rather than the `Speaker` record, because matching must not read: the
 * caller assembles this from lists it already has (`listSpeakers`, `listSubmissions`,
 * `listSubmissionParticipants`) and `matchPortal` stays pure. It is also what makes the
 * wizard's review step cheap, since previewing a filter over 400 contacts is then array
 * work rather than 400 lookups.
 */
export type PortalContact = {
  speakerId: RecordId
  company?: string
  /** Every role this person holds on this event, across every submission. */
  roles: readonly PortalContactType[]
  sessions: readonly PortalContactSession[]
}

/** The session-side facts a filter can test, per submission the contact is on. */
export type PortalContactSession = {
  submissionId: RecordId
  format?: string
  level?: string
  language?: string
  trackId?: RecordId
  tagIds: readonly RecordId[]
}
