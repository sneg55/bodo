// Near-duplicate speaker detection for the CRM directory.
//
// The CSV importer already has a duplicate rule (`features/crm/import/dedup.ts`) and this
// module deliberately does NOT invent a second one: `normalizeEmail` is imported from there,
// so `ada@example.com`, ` ADA@EXAMPLE.COM ` and the address `planRow` / `loadSpeakersByEmail`
// key on are one value here too. Two normalizations would mean the importer silently updates
// a record the directory is at the same moment offering to merge.
//
// What this adds is the case the importer cannot have: the importer answers "does this ROW
// already exist", and an email is the only key a CSV row carries. The directory answers "are
// two RECORDS the same person", and the case an organizer actually hits is the one the audit
// found - the same human entered twice under two addresses (a work one and a personal one),
// which shares a name and nothing else. So there are two relations, not one:
//
//   - `email`: same normalized email. Certain. Airtable enforces no uniqueness on the column,
//     so this is a real state rather than a defensive check, and `winsEmailTie` exists
//     precisely because it happens.
//   - `name`: same normalized full name. A SUGGESTION. Two people genuinely called Priya
//     Raman is not impossible, which is why nothing here merges anything by itself and why
//     the surface says "possible".
//
// The two are unioned into CLUSTERS rather than reported as separate pairs, because merge
// operates on a set: A and B share an email, B and C share a name, and offering the organizer
// two overlapping pairs would let them merge A into B and then C into a record that no longer
// exists. A cluster is a connected component of both relations at once.
//
// Nothing here reads Airtable or the clock: it takes the rows the directory already built.

import { normalizeEmail } from '@/features/crm/import/dedup'
import type { RecordId, Speaker } from '@/types/domain'

/** Why two records are in one cluster. `email` is certain; `name` is a suggestion. */
export type DuplicateReason = 'email' | 'name'

export type DuplicateCluster = {
  /** Every record in the cluster, in the order the directory listed them. Always 2 or more. */
  readonly speakerIds: readonly RecordId[]
  /**
   * The strongest relation present anywhere in the cluster. `email` when at least one pair
   * shares an address, `name` otherwise, so the badge can distinguish "certainly the same
   * person" from "looks like it".
   */
  readonly reason: DuplicateReason
  /** What the cluster is called on screen: the display name of its first member. */
  readonly label: string
}

/**
 * The identity half of a speaker, which is all either relation reads.
 *
 * Narrower than `Speaker` on purpose, the same way `ExistingSpeaker` is in the importer's
 * dedup module: a rule that can only see these three fields cannot start depending on a
 * biography or a tag, and any caller holding whole `Speaker` records satisfies it already.
 */
export type DuplicateCandidate = Pick<Speaker, 'id' | 'email' | 'firstName' | 'lastName'>

/**
 * The name key: case-folded, punctuation-stripped, whitespace-collapsed.
 *
 * Stricter than `normalizeEmail` because a name is typed by hand every time it is entered,
 * so `Priya Raman`, `priya  raman` and `Priya Râman`... are not all one value, and the last
 * one deliberately is not: stripping accents would fold `Muller` and `Müller` together, and
 * those are two different surnames rather than two spellings of one. Punctuation goes because
 * `O'Neill` and `ONeill` are one person; case goes for the obvious reason.
 *
 * Falls back to the display name (`speakerName`), which means a record with no name at all
 * keys on its email - and that is correct rather than a coincidence: two records with no name
 * and one email are the email relation's business, and this returns '' for them below.
 */
export function nameKey(speaker: DuplicateCandidate): string {
  const full = `${speaker.firstName} ${speaker.lastName}`.trim()
  return full
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s]/gu, '')
    .replaceAll(/\s+/g, ' ')
    .trim()
}

/** Disjoint-set over record ids. Small, local, and the only way to union two relations. */
function findRoot(parents: Map<string, string>, id: string): string {
  let root = id
  let next = parents.get(root)
  while (next !== undefined && next !== root) {
    root = next
    next = parents.get(root)
  }
  return root
}

function union(parents: Map<string, string>, left: string, right: string): void {
  const leftRoot = findRoot(parents, left)
  const rightRoot = findRoot(parents, right)
  if (leftRoot !== rightRoot) parents.set(rightRoot, leftRoot)
}

/** Key to the ids carrying it, skipping the empty key, which is "no value" and not a match. */
function groupBy(
  speakers: readonly DuplicateCandidate[],
  key: (speaker: DuplicateCandidate) => string,
): ReadonlyMap<string, readonly string[]> {
  const groups = new Map<string, string[]>()
  for (const speaker of speakers) {
    const value = key(speaker)
    if (value === '') continue
    const existing = groups.get(value)
    if (existing === undefined) {
      groups.set(value, [speaker.id])
      continue
    }
    existing.push(speaker.id)
  }
  return groups
}

/**
 * Every cluster of two or more records that look like one person.
 *
 * Order is the input's order, both between clusters (by where their first member sits) and
 * inside one, so a directory sorted by family name lists its duplicate groups in the same
 * sequence the organizer is already scanning.
 *
 * `speakers` must be every record in the viewer's scope, NOT the visible page: a duplicate
 * whose twin is on page 2 is exactly the case this exists to catch, which is why the caller
 * (`loadCrmDirectory`) computes this before it pages.
 */
export function findDuplicateClusters(
  speakers: readonly DuplicateCandidate[],
): readonly DuplicateCluster[] {
  const parents = new Map<string, string>(speakers.map((speaker) => [speaker.id, speaker.id]))
  const emailGroups = groupBy(speakers, (speaker) => normalizeEmail(speaker.email))
  const nameGroups = groupBy(speakers, nameKey)

  for (const ids of [...emailGroups.values(), ...nameGroups.values()]) {
    for (const id of ids.slice(1)) union(parents, ids[0] ?? id, id)
  }

  // Any id that shares an email with another is in an `email` cluster, whatever else joined
  // it. Collected before the walk so the reason is a property of the cluster rather than of
  // whichever member happened to be visited first.
  const sharesEmail = new Set(
    [...emailGroups.values()].filter((ids) => ids.length > 1).flatMap((ids) => ids),
  )

  const byRoot = new Map<string, string[]>()
  for (const speaker of speakers) {
    const root = findRoot(parents, speaker.id)
    const existing = byRoot.get(root)
    if (existing === undefined) {
      byRoot.set(root, [speaker.id])
      continue
    }
    existing.push(speaker.id)
  }

  const nameOf = new Map(speakers.map((speaker) => [speaker.id, displayName(speaker)]))
  return [...byRoot.values()]
    .filter((ids) => ids.length > 1)
    .map((ids) => ({
      speakerIds: ids,
      reason: ids.some((id) => sharesEmail.has(id)) ? ('email' as const) : ('name' as const),
      label: nameOf.get(ids[0] ?? '') ?? '',
    }))
}

/** `speakerName` in speaker-rows.ts needs a whole `Speaker`; this rule has the identity half. */
function displayName(speaker: DuplicateCandidate): string {
  const full = `${speaker.firstName} ${speaker.lastName}`.trim()
  return full.length > 0 ? full : speaker.email
}

/**
 * Speaker id to the reason its row carries a badge. The lookup the table cell wants, so a
 * cell does not scan every cluster per render.
 */
export function duplicateReasons(
  clusters: readonly DuplicateCluster[],
): ReadonlyMap<RecordId, DuplicateReason> {
  return new Map(
    clusters.flatMap((cluster) => cluster.speakerIds.map((id) => [id, cluster.reason] as const)),
  )
}
