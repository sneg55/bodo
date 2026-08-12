// Which portal a contact lands in. BUILD_SPEC 5.0c.
//
// Pure, and separate from the reads that feed it, for the same reason
// `features/resources/pages.ts` is: this decides what a speaker can see, and the failure
// is invisible from the admin side, where every portal looks the same. A filter matching
// nobody and a filter matching everybody render identically on the list screen; the only
// person who finds out is the speaker who never receives their tasks.
//
// The rule, in the vendor's own words: "the contact will be assigned to the first portal
// in the list that they qualify for, based on the order of the portals", and anyone
// qualifying for nothing lands on the default portal. So the arithmetic is first match
// wins over an ordered list, which is precisely the shape that is expensive to debug
// through the UI and cheap to pin down in a test.
//
// It never reads. The caller assembles `PortalContact` from lists it already has
// (`buildPortalContacts` in contacts.ts), which is also what makes the wizard's review
// step cheap: previewing a filter over 400 contacts is array work, not 400 lookups.

import type { RecordId } from '@/types/domain'
import type {
  Portal,
  PortalContact,
  PortalContactSession,
  PortalContactType,
  PortalFilterRule,
  PortalFilters,
} from '@/types/portals'

/**
 * The portal one contact belongs to, or `undefined` when the event has no default row.
 *
 * `undefined` is deliberately not "the first portal": an event without exactly one
 * default is a write-path bug (`savePortal` refuses such a save, and the default is
 * created with the event), and inventing a home here would hide it behind a portal that
 * looks plausible. The caller renders nothing and the count column shows the gap.
 */
export function matchPortal(
  portals: readonly Portal[],
  contact: PortalContact,
): Portal | undefined {
  return firstMatch(orderPortals(portals), contact)
}

/**
 * Every contact on the event bucketed by portal, which is what both callers need: the
 * list screen's matched-count column and the wizard's review step.
 *
 * One pass with the portals ordered once, rather than `matchPortal` per contact, because
 * the review step runs this on every keystroke in the filter editor.
 *
 * Every portal gets a bucket, empty ones included, so the count column renders `0` rather
 * than a blank cell. A filter that matches nobody is the failure mode of this whole
 * feature and the empty bucket is the only place it is visible before a speaker complains.
 *
 * Contacts keep their input order inside a bucket. The caller has already sorted them
 * (`listSpeakers` sorts on last name) and re-sorting here would silently override that.
 */
export function assignContacts(
  portals: readonly Portal[],
  contacts: readonly PortalContact[],
): Map<RecordId, PortalContact[]> {
  const ordered = orderPortals(portals)
  const buckets = new Map<RecordId, PortalContact[]>(ordered.map((portal) => [portal.id, []]))

  for (const contact of contacts) {
    const portal = firstMatch(ordered, contact)
    if (portal === undefined) continue
    buckets.get(portal.id)?.push(contact)
  }
  return buckets
}

/**
 * Does one contact qualify for one filter set?
 *
 * Exported because the wizard's review step and the tests both need to ask the question
 * about a filter that is not yet a saved `Portal`, and because a rule editor that cannot
 * preview one rule at a time is a rule editor nobody can debug.
 *
 * Two gates, and both must pass: the contact TYPE (step one of the wizard) and the rules
 * (step two). Rules are ANDed, because an OR across two different fields is a second
 * portal, which is the mechanism this feature already has (types/portals.ts).
 */
export function matchesFilters(filters: PortalFilters, contact: PortalContact): boolean {
  if (!matchesContactTypes(filters.contactTypes, contact.roles)) return false
  return filters.rules.every((rule) => matchesRule(rule, contact))
}

/**
 * The default portal is never MATCHED, it is FALLEN BACK TO.
 *
 * It carries no filters, and if somebody wrote some by hand they are ignored here on
 * purpose: it is the "everyone else" bucket by definition, so letting its filters run
 * would let a stray rule leave a contact with no portal at all. Reading it as a normal
 * candidate would be worse still: an empty filter set matches everyone, so a default
 * sitting at order 0 would swallow every contact before any custom portal saw them.
 */
function firstMatch(ordered: readonly Portal[], contact: PortalContact): Portal | undefined {
  const matched = ordered.find(
    (portal) => !portal.isDefault && matchesFilters(portal.filters, contact),
  )
  return matched ?? ordered.find((portal) => portal.isDefault)
}

/**
 * Ascending `order`, ties broken on id so the answer is deterministic.
 *
 * The tie-break is a safety net over a correctness bug, not a display preference. Two
 * portals sharing an order number make a contact's portal depend on the sequence Airtable
 * happened to paginate them in, so the same contact can move between portals between two
 * reads with nothing written. The write path is what actually prevents it, by dense
 * renumbering from 0 on every save (`denseOrder` in content.ts does the same job for
 * items); breaking on id here only guarantees that when the invariant is already broken
 * the wrong answer is at least the same wrong answer every time, which is the difference
 * between a bug that can be reproduced and one that cannot.
 */
function orderPortals(portals: readonly Portal[]): readonly Portal[] {
  return [...portals].sort((left, right) =>
    left.order !== right.order ? left.order - right.order : compareIds(left.id, right.id),
  )
}

/**
 * An empty `contactTypes` means EVERY type, which is what the default portal carries and
 * what a custom portal targeting "anyone who matches these rules" wants. A non-empty list
 * matches a contact holding ANY of those roles: a person who is a speaker on one session
 * and a moderator on another qualifies for a Moderators portal, because they do moderate.
 */
function matchesContactTypes(
  wanted: readonly PortalContactType[],
  roles: readonly PortalContactType[],
): boolean {
  if (wanted.length === 0) return true
  return roles.some((role) => wanted.includes(role))
}

/**
 * One rule.
 *
 * An empty `values` matches NOTHING, for both operators, and the second half of that is
 * the part worth stating. Negating an empty set would make `is_not []` match everyone, so
 * a half-built exclusion rule would publish a portal to the whole conference the moment
 * an organizer picked the field and before they picked a value. Excluding instead means a
 * half-built rule excludes people from a CUSTOM portal, and everyone excluded falls
 * through to the default, which is where they would have been anyway.
 */
function matchesRule(rule: PortalFilterRule, contact: PortalContact): boolean {
  if (rule.values.length === 0) return false
  const holds = ruleHolds(rule, contact)
  return rule.operator === 'is' ? holds : !holds
}

/**
 * "This contact has at least one of these values", before the operator is applied.
 *
 * `is_not` is therefore the exact negation of `is` over the same question, and that is
 * the judgement call this file has to make, because "Track is not Keynote" over a speaker
 * with two sessions (one of them a keynote) has two defensible readings:
 *
 *   (a) NO session of theirs is on that track. Chosen.
 *   (b) SOME session of theirs is not on that track.
 *
 * (a) wins because it is the only reading under which `is` and `is_not` partition the
 * contacts: under (b) the busy speaker matches both "Track is Keynote" and "Track is not
 * Keynote", so which portal they land in is decided purely by which rule sits earlier in
 * the list, and an organizer looking at two portals with opposite filters cannot predict
 * the answer. (a) also matches how the requirement was phrased when the operator was
 * introduced, "everyone except the keynote track" (types/portals.ts), which is exclusion
 * of the person, not of one of their sessions.
 *
 * The consequence to know: a contact with NO sessions passes every session-field
 * `is_not` rule vacuously, and fails every session-field `is` rule. That is the same
 * negation applied consistently, and it puts a session-less contact in the "everyone
 * except X" portal, which is where "except" says they belong.
 */
function ruleHolds(rule: PortalFilterRule, contact: PortalContact): boolean {
  const { field, values } = rule

  switch (field) {
    case 'role':
      return contact.roles.some((role) => matchesText(role, values))
    // A contact with no company fails `is` and therefore passes `is_not`. "Company is not
    // Acme" is true of somebody with no company on file: they are not at Acme.
    case 'company':
      return matchesText(contact.company, values)
    // ANY session, never ALL. A speaker with three sessions on three tracks qualifies for
    // a track filter naming any one of them; requiring all of them would silently exclude
    // exactly the busiest people at the conference, who are the ones whose portal being
    // wrong costs the most.
    case 'format':
    case 'level':
    case 'language':
    case 'track':
    case 'tag':
      return contact.sessions.some((session) => sessionHolds(field, values, session))
  }
}

function sessionHolds(
  field: Exclude<PortalFilterRule['field'], 'role' | 'company'>,
  values: readonly string[],
  session: PortalContactSession,
): boolean {
  switch (field) {
    case 'format':
      return matchesText(session.format, values)
    case 'level':
      return matchesText(session.level, values)
    case 'language':
      return matchesText(session.language, values)
    // `track` and `tag` carry RECORD IDS in `values`, not names (types/portals.ts), so
    // they compare exactly: an id is opaque and case is meaningful in it, while folding
    // one would be a same-prefix collision waiting to happen.
    case 'track':
      return session.trackId !== undefined && values.includes(session.trackId)
    case 'tag':
      return session.tagIds.some((tagId) => values.includes(tagId))
  }
}

/**
 * Free-text and single-select values compare case- and whitespace-insensitively.
 *
 * The values on one side were typed by an organizer into the filter editor and on the
 * other by a speaker into a submission form, so `Acme ` and `acme` are the same company
 * to everyone except a strict comparison, and a filter that silently drops half a company
 * is the failure this whole module exists to make visible. An absent value matches
 * nothing, rather than matching an empty string in `values`, so a stray blank option in
 * the editor cannot select every contact who left the field empty.
 */
function matchesText(value: string | undefined, values: readonly string[]): boolean {
  if (value === undefined) return false
  const wanted = normalize(value)
  if (wanted === '') return false
  return values.some((candidate) => normalize(candidate) === wanted)
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function compareIds(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}
