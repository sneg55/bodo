// Copying a portal. BUILD_SPEC 5.0c, and the vendor's own ellipsis menu (Delete, Duplicate,
// Edit Tasks).
//
// Pure, and its own module rather than a limb of the action, because both halves of a
// duplicate are decisions rather than plumbing: what the copy is called, and what "the same
// portal" means when the thing being copied is an exposure gate. Both are cheap to pin in a
// test and expensive to notice through the UI, which is the same argument `match.ts` makes.
//
// **The copy takes the CONTENT with it.** A duplicate that copied the filters but not the
// PortalItems rows would be a portal that matches exactly the audience the organizer asked
// for and exposes nothing to them, which reads on every admin screen as a working portal.
// §5.0c is explicit that duplicating is one of the three menu items, and the reason to
// duplicate is to vary a filter, not to start from an empty content tab.

import { nextPortalOrder } from '@/features/portal-config/invariants'
import type { PortalItemCreate } from '@/services/airtable/mutations-portal-items'
import type { PortalDraft } from '@/services/airtable/to-fields-portals'
import type { RecordId } from '@/types/domain'
import type { Portal } from '@/types/portals'
import type { PortalItem, PortalItemType } from '@/types/resources'

/** What a copy is called before an organizer renames it. The vendor's own suffix. */
const COPY_SUFFIX = 'Copy'

/**
 * A name no other portal on the event holds.
 *
 * `Speakers` becomes `Speakers Copy`, then `Speakers Copy 2`, `Speakers Copy 3`. Airtable
 * has no unique index on `name`, so nothing but this stops an organizer duplicating twice
 * and being left with two rows called `Speakers Copy` in a list whose whole job is to say
 * which portal a contact lands in. Two rows with one name make that list unreadable, and
 * the count column beside them unattributable.
 *
 * Compared case-insensitively and on trimmed text, because `speakers copy` and
 * `Speakers Copy ` are the same name to the organizer reading the list, and a collision the
 * eye can see but the code cannot is worse than no check at all.
 *
 * The counter starts at 2 rather than 1 so the sequence reads as a human would number it:
 * the first copy carries no number, and the second is the second.
 */
export function duplicatePortalName(
  existing: readonly Portal[],
  source: Pick<Portal, 'name'>,
): string {
  const taken = new Set(existing.map((portal) => normalize(portal.name)))
  const base = `${source.name.trim()} ${COPY_SUFFIX}`.trim()
  if (!taken.has(normalize(base))) return base

  // Bounded by the number of portals plus one, so a candidate is always free: every earlier
  // attempt can have been taken by at most one existing row. An unbounded loop here would be
  // an unbounded loop driven by table contents.
  for (let suffix = 2; suffix <= existing.length + 2; suffix += 1) {
    const candidate = `${base} ${suffix}`
    if (!taken.has(normalize(candidate))) return candidate
  }
  return base
}

/**
 * The new portal's own row: the source's filters and settings, under a free name.
 *
 * **Always non-default, and always last.** Non-default because there is exactly one default
 * per event by construction and a copy cannot be a second one. Last because first match wins,
 * so inserting a copy above portals an organizer already tuned would reassign contacts away
 * from them with nothing on screen to say it happened. That position is one past the highest
 * order in use (`nextPortalOrder`), NOT `existing.length`: a delete leaves a gap on purpose,
 * since a gap is not a tie, so an event that ran `0, 1, 2` and lost the middle one has a
 * length of 2 and a portal already sitting at 2. Review caught that; the two would have
 * collided and a tie decides a contact's portal by tie-break rather than by arrangement.
 *
 * **The known sharp edge, stated rather than guarded.** Duplicating the DEFAULT portal
 * produces a custom portal with no filters, and a custom portal with no filters matches
 * everybody (`matchesFilters` reads an empty rule set as no constraint), so the copy becomes
 * a catch-all sitting above the default. That is the same thing saving a new portal before
 * writing any rules does, it is visible immediately in the list screen's matched count, and
 * refusing it would block the ordinary "copy this, then narrow it" flow the menu exists for.
 *
 * `kind` is written as `contacts` rather than carried across, because groups portals need
 * the sponsors and exhibitors module and nothing in this codebase writes that value. Copying
 * it would be the one code path able to produce a row bodo cannot render.
 */
export function portalCopyDraft(existing: readonly Portal[], source: Portal): PortalDraft {
  return {
    eventId: source.eventId,
    name: duplicatePortalName(existing, source),
    kind: 'contacts',
    isDefault: false,
    order: nextPortalOrder(existing),
    filters: source.filters,
    welcomeMessage: source.welcomeMessage,
    alwaysShowTasks: source.alwaysShowTasks,
    manageProfile: source.manageProfile,
  }
}

/**
 * The rows the copy needs, taken from the rows the source portal actually owns.
 *
 * **Only the source's own rows.** A row with no `portal` link belongs to the event's DEFAULT
 * portal (types/resources.ts), which is a migration state and not a wildcard, so it is
 * copied when the source IS the default and ignored otherwise. Reading an absent link as
 * "belongs to whoever is asking" would make every duplicate of a custom portal inherit the
 * default portal's legacy content, published, in front of an audience nobody chose.
 *
 * The `eventId` check is made as well as the portal check, for the reason
 * `features/resources/pages.ts` gives: both sides of the join carry an event and only one of
 * them is filtered by the read.
 *
 * `enabled` and `order` are carried across verbatim rather than renumbered. The copy is
 * meant to be the same portal until an organizer changes it, and the source's numbers are
 * already dense (the editor renumbers on every save), so renumbering here would only be a
 * chance to disagree with the screen the organizer just duplicated from.
 *
 * A row whose link column is empty is dropped rather than copied with a missing target: it
 * publishes nothing on the source either, and copying it would put a row in the base that no
 * reader can attribute and no editor can switch off.
 */
export function duplicatePortalItems(
  source: Portal,
  items: readonly PortalItem[],
): readonly PortalItemCreate[] {
  const copies: PortalItemCreate[] = []

  for (const item of items) {
    if (item.eventId !== source.eventId) continue
    if (!belongsTo(source, item)) continue
    const itemId = sourceIdOf(item)
    if (itemId === undefined) continue
    copies.push({ itemType: item.itemType, itemId, enabled: item.enabled, order: item.order })
  }
  return copies
}

function belongsTo(portal: Portal, item: PortalItem): boolean {
  if (item.portalId === undefined) return portal.isDefault
  return item.portalId === portal.id
}

/**
 * The one link `itemType` names, or `undefined` when the row carries none.
 *
 * `itemType` decides which column is meaningful, exactly as `content.ts` reads it: a task
 * row that somehow carried a resource link must not copy a page nobody asked to publish.
 */
function sourceIdOf(item: PortalItem): RecordId | undefined {
  const byType: Record<PortalItemType, RecordId | undefined> = {
    task: item.taskId,
    form: item.formId,
    file_request: item.fileRequestId,
    resource: item.resourceId,
  }
  return byType[item.itemType]
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}
