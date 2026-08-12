'use server'

// The Portals writes, and every one of them authorizes for itself. BUILD_SPEC 5.0c.
//
// The order is the security property, not a style, and it is the one
// `features/resources/actions.ts` sets out: (1) `requirePortalAdmin(eventId)`, so capability
// comes from EventMemberships on every call rather than from a 30 day session cookie that
// cannot be revoked; (2) resolve the record and check it belongs to THAT event, so an admin
// of event A cannot edit event B's portal by posting B's record id; (3) validate; (4) write,
// and let the DAL expire `event:{id}:portals`, which is `event:{id}:resources` under another
// name (tags.ts), because a stale portal `order` is a contact in the wrong portal.
//
// Step 1 is here and not only in `(admin)/admin/[eventId]/layout.tsx` because a Server
// Action is reachable by POST with no layout ever rendering (BUILD_SPEC 4).
//
// **Every list this file decides a write from is read UNCACHED.** `listPortalsUncached` and
// `listPortalItemsUncached` exist for exactly that (their headers give the reason): deciding
// exactly-one-default, or a dense renumber, or create-versus-update, from a cached snapshot
// is how an event ends up with two default portals and nothing downstream can tell which one
// is real. The invariants themselves live in ./invariants.ts.
//
// Nothing here writes a `TaskAssignment` or a `FileRequestAssignment`. PortalItems is an
// exposure gate over the assignment, never a substitute for it.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { ownedPortal, requirePortalAdmin } from '@/features/portal-config/authorize'
import { buildPortalContent } from '@/features/portal-config/content'
import { duplicatePortalItems, portalCopyDraft } from '@/features/portal-config/duplicate'
import {
  DEFAULT_PORTAL_ORDER,
  nextPortalOrder,
  type PortalActionResult,
  pinnedPortalOrder,
  portalActionFailure,
  reasonOf,
  requireOneDefault,
  requireOwnPortal,
} from '@/features/portal-config/invariants'
import { type PortalItemRow, planPortalItems } from '@/features/portal-config/items'
import { writePortalItems } from '@/services/airtable/mutations-portal-items'
import {
  createPortal,
  deletePortal,
  reorderPortals,
  updatePortal,
} from '@/services/airtable/mutations-portals'
import {
  listFileRequests,
  listForms,
  listResources,
  listTasksForEvent,
} from '@/services/airtable/queries'
import { listPortalsUncached } from '@/services/airtable/reads-portals'
import { listPortalItemsUncached } from '@/services/airtable/reads-resources'
import type { RecordId } from '@/types/domain'
import { EMPTY_PORTAL_FILTERS, type PortalFilters } from '@/types/portals'

// `export type { PortalActionResult }` stood here and 500'd every portal write; import
// it from ./invariants.ts. Why, and the lint rule: eslint.restricted-syntax.mjs.
/**
 * Create or edit one portal.
 *
 * **`isDefault` is not an input and never will be.** A portal is created custom, and the
 * default is created with the event (`features/events/actions.ts`), so moving the flag would
 * be a two-row handover with no transaction behind it. What this action does instead is
 * refuse to write at all while the event does not already carry exactly one default, because
 * a save committed on top of that state compounds it into a list nothing downstream can
 * interpret (./invariants.ts).
 *
 * The default portal's own edit is narrowed rather than blocked: name, welcome message and
 * the two switches are its, while `order` is forced back to 0 and `filters` back to empty.
 * Storing filters on it would show an organizer a rule that provably does nothing, since
 * `firstMatch` skips them. `kind` is always `contacts`, since groups portals need the
 * sponsors and exhibitors module and that is on the waiver list.
 */
export async function savePortalAction(input: {
  eventId: RecordId
  /** Absent creates. Present edits, after the id is checked against the event's own list. */
  portalId?: RecordId
  name: string
  filters: PortalFilters
  welcomeMessage?: string
  alwaysShowTasks: boolean
  manageProfile: boolean
}): Promise<PortalActionResult> {
  try {
    await requirePortalAdmin(input.eventId)

    const name = input.name.trim()
    if (name === '') return { ok: false, error: 'Give the portal a name.' }

    const portals = await listPortalsUncached(input.eventId)
    requireOneDefault(input.eventId, portals)

    const settings = {
      welcomeMessage: input.welcomeMessage,
      alwaysShowTasks: input.alwaysShowTasks,
      manageProfile: input.manageProfile,
    }

    if (input.portalId === undefined) {
      // Last in the order: a new portal must not silently claim contacts away from portals
      // an organizer already tuned. First match wins, so inserting above them would reassign
      // people with nothing on screen to say it happened.
      const created = await createPortal({
        eventId: input.eventId,
        name,
        kind: 'contacts',
        isDefault: false,
        order: nextPortalOrder(portals),
        filters: input.filters,
        ...settings,
      })
      return { ok: true, portalId: created.id }
    }

    const existing = requireOwnPortal(portals, input.portalId, input.eventId)
    await updatePortal({
      portalId: existing.id,
      eventId: input.eventId,
      update: {
        name,
        kind: existing.kind,
        // All three read off the STORED row, never off the payload. This is the whole of the
        // exactly-one-default enforcement on the edit path: the flag cannot move, so a save
        // can neither create a second default nor drop the last one.
        isDefault: existing.isDefault,
        order: existing.isDefault ? DEFAULT_PORTAL_ORDER : existing.order,
        filters: existing.isDefault ? EMPTY_PORTAL_FILTERS : input.filters,
        ...settings,
      },
    })
    return { ok: true, portalId: existing.id }
  } catch (error) {
    return portalActionFailure(error)
  }
}

/**
 * Delete a portal and the rows that published content into it.
 *
 * The default is refused HERE as well as inside `deletePortal`, and the duplication is
 * deliberate: this is the security boundary and that is the last place that can still see
 * the record. Deleting the default does not remove a portal, it removes the floor, so every
 * contact matching no filter has nowhere to land and the symptom is speakers seeing an empty
 * portal rather than anything an organizer did.
 *
 * The survivors are NOT renumbered afterwards. A delete leaves a gap in `order` and a gap is
 * not a tie: first match wins over an ascending sort, so 0, 1, 3 walks in the same sequence
 * 0, 1, 2 does. Renumbering would be a second write on a path that has already committed
 * one, for nothing.
 */
export async function deletePortalAction(input: {
  eventId: RecordId
  portalId: RecordId
}): Promise<PortalActionResult> {
  try {
    await requirePortalAdmin(input.eventId)
    const portal = await ownedPortal(input.eventId, input.portalId)
    if (portal.isDefault) return { ok: false, error: 'The default portal cannot be deleted.' }

    await deletePortal({ portalId: portal.id, eventId: input.eventId })
    return { ok: true, portalId: portal.id }
  } catch (error) {
    return portalActionFailure(error)
  }
}

/**
 * Copy a portal, its filters, its settings and its content. What the copy IS is decided by
 * `portalCopyDraft`, next to the name derivation; this is the two writes it takes.
 *
 * **The content is copied too, and that is the point.** A duplicate carrying the filters but
 * not the PortalItems rows is a portal that matches exactly the audience asked for and
 * exposes nothing to them, which reads on every admin screen as a working portal.
 *
 * The two writes cannot land together, since Airtable has no transaction. The portal goes
 * first, so a failed content copy leaves a portal exposing less than the source rather than
 * content attached to a portal that does not exist. The failure names the new record's id,
 * because without it the organizer has a half-copy they can neither find nor finish.
 */
export async function duplicatePortalAction(input: {
  eventId: RecordId
  portalId: RecordId
}): Promise<PortalActionResult> {
  try {
    await requirePortalAdmin(input.eventId)
    const portals = await listPortalsUncached(input.eventId)
    const source = requireOwnPortal(portals, input.portalId, input.eventId)

    const created = await createPortal(portalCopyDraft(portals, source))
    const items = await listPortalItemsUncached(input.eventId)
    try {
      await writePortalItems({
        eventId: input.eventId,
        portalId: created.id,
        creates: duplicatePortalItems(source, items),
        patches: [],
      })
    } catch (cause) {
      throw new AppError(
        ErrorIds.DATA_WRITE_FAIL,
        `The portal was duplicated but its tasks, forms, file requests and pages were not copied. Its record id is ${created.id}; delete it and try again.`,
        { eventId: input.eventId, portalId: created.id, cause: reasonOf(cause) },
      )
    }

    return { ok: true, portalId: created.id }
  } catch (error) {
    return portalActionFailure(error)
  }
}

/**
 * Dense-renumber the event's portals from 0, in the order given.
 *
 * A tie here is a correctness bug and not a display one: two portals sharing a number make a
 * contact's portal depend on the sequence Airtable happened to paginate them in, which is
 * stable enough to look fine and unstable enough to change on the next read.
 *
 * So the sequence written is built rather than trusted, by `pinnedPortalOrder`, which pins
 * the default first and appends anything the payload omitted. What is enforced HERE, before
 * that, is that every posted id is a portal on this event: `requireOwnPortal` refuses the
 * whole request rather than letting `pinnedPortalOrder` quietly drop a foreign id and write a
 * plausible-looking order off a payload that was already describing another conference.
 */
export async function reorderPortalsAction(input: {
  eventId: RecordId
  portalIds: readonly RecordId[]
}): Promise<PortalActionResult> {
  try {
    await requirePortalAdmin(input.eventId)
    const portals = await listPortalsUncached(input.eventId)
    const fallback = requireOneDefault(input.eventId, portals)

    for (const portalId of input.portalIds) {
      requireOwnPortal(portals, portalId, input.eventId)
    }

    await reorderPortals({
      eventId: input.eventId,
      portalIds: pinnedPortalOrder(portals, fallback, input.portalIds),
    })
    return { ok: true, portalId: fallback.id }
  } catch (error) {
    return portalActionFailure(error)
  }
}

/**
 * Save one portal's content cards: what it exposes, and in what order.
 *
 * **This is an exposure gate, never an assignment.** It cannot create or delete a
 * `TaskAssignment` or a `FileRequestAssignment` and it does not read them: who owes what is
 * fanned out per (task, speaker, submission) at accept time. An enabled row shows a speaker
 * only what they are already assigned; a disabled one hides the surface from everybody.
 *
 * The diff is against `listPortalItemsUncached`, while the four source lists are the ordinary
 * cached reads, and the split is deliberate: the source lists only say which records exist,
 * where a stale answer costs a refused row, while the PortalItems rows decide
 * create-versus-update, where a stale answer is a duplicate row the organizer then has two of
 * and can toggle only one of.
 *
 * `buildPortalContent` is what makes the posted rows safe to act on: it resolves which rows
 * belong to this portal, that only `kind: 'task'` forms may sit on one, and what absence
 * means per kind. Anything the payload names that is not in the result is a record from
 * another conference or a CFP form, and it is refused rather than written.
 */
export async function savePortalItemsAction(input: {
  eventId: RecordId
  portalId: RecordId
  rows: readonly PortalItemRow[]
}): Promise<PortalActionResult> {
  try {
    await requirePortalAdmin(input.eventId)
    const portal = await ownedPortal(input.eventId, input.portalId)

    const [tasks, forms, fileRequests, resources, items] = await Promise.all([
      listTasksForEvent(input.eventId),
      listForms(input.eventId),
      listFileRequests(input.eventId),
      listResources(input.eventId),
      listPortalItemsUncached(input.eventId),
    ])

    const content = buildPortalContent(portal, { tasks, forms, fileRequests, resources }, items)
    const planned = planPortalItems(portal, content, input.rows)
    if (!planned.ok) {
      return {
        ok: false,
        error: `This portal cannot expose ${planned.unknown.length} of the items you selected, because they are not on this event.`,
      }
    }

    await writePortalItems({ eventId: input.eventId, portalId: portal.id, ...planned.plan })
    return { ok: true, portalId: portal.id }
  } catch (error) {
    return portalActionFailure(error)
  }
}
