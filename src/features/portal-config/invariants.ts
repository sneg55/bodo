// The two invariants a Portals write must not break, and the shape a refusal takes.
//
// Split out of ./actions.ts because both are decisions over the WHOLE list rather than over
// the row being written, and because they are the part worth pinning in a test: an event
// with no default portal, or with two, or with two portals sharing an `order`, all render
// identically on the list screen and only show up as a speaker landing in the wrong portal.
//
//   1. **Exactly one default per event.** `matchPortal` returns `undefined` when there is
//      none, so contacts land nowhere; `firstMatch` picks by record id when there are two,
//      so which portal a speaker sees changes with the data.
//   2. **The order is total, dense from 0, with the default pinned first.**
//
// Neither is expressible in Airtable, which has no unique index and no check constraint, so
// the write path is the only place they exist.

import { AppError, ErrorIds, isAppError } from '@/constants/errorIds'
import type { RecordId } from '@/types/domain'
import type { Portal } from '@/types/portals'

/** What every portal action hands back to the client component that called it. */
export type PortalActionResult = { ok: true; portalId?: RecordId } | { ok: false; error: string }

/**
 * The default portal is pinned to position 0 and cannot be dragged.
 *
 * §5.0c says it "cannot be deleted or reordered below a custom one", which reads as "it
 * stays at the top". **Its position is presentational, and that is exactly why pinning it is
 * safe.** `matchPortal` never treats the default as a CANDIDATE: it is fallen back to, not
 * matched, and its filters are ignored even if a stray one exists. So a default sitting at
 * order 0 does not swallow the whole conference the way a custom portal at order 0 would.
 * Without that sentence, "the fallback is first in a first-match-wins list" reads as a bug.
 */
export const DEFAULT_PORTAL_ORDER = 0

/**
 * The event's one default portal, or a refusal.
 *
 * Called with the UNCACHED list every time a write is about to touch the ordering or the
 * flag. Neither failure direction can be repaired by writing ON TOP of it, so the write is
 * refused rather than attempted.
 *
 * THE TWO DIRECTIONS NOW SAY DIFFERENT THINGS, because only one of them is still a dead end.
 * Zero is repairable from inside the product: the Portals screen offers the button that
 * writes the missing row (`features/portal-config/repair-actions.ts`), so sending an
 * organizer to Airtable for it was telling them to go and do by hand what the button in
 * front of them does. Two or more genuinely is not repairable here, and not for want of
 * effort: nothing in the data says which default should survive, and picking one would be
 * this code silently deciding which contacts get reassigned.
 */
export function requireOneDefault(eventId: RecordId, portals: readonly Portal[]): Portal {
  const defaults = portals.filter((portal) => portal.isDefault)
  const only = defaults.at(0)
  if (defaults.length !== 1 || only === undefined) {
    throw new AppError(
      ErrorIds.DATA_WRITE_FAIL,
      defaults.length === 0
        ? 'This event has no default portal and needs exactly one. Create it from the Portals screen, then try again.'
        : `This event has ${String(defaults.length)} default portals and needs exactly one. Only one can remain, and which is a decision this cannot make for you.`,
      { eventId, defaults: defaults.length },
    )
  }
  return only
}

/**
 * A portal from the event's own list, or a refusal.
 *
 * `AUTH_FORBIDDEN_ROLE` rather than "not found", for the reason `ownedPortal` gives in
 * ./authorize.ts: a caller who holds admin on this event and posted somebody else's record
 * id is not looking at a missing row. Resolved out of a list the action has already read, so
 * the check costs no extra Airtable request.
 */
export function requireOwnPortal(
  portals: readonly Portal[],
  portalId: RecordId,
  eventId: RecordId,
): Portal {
  const portal = portals.find((row) => row.id === portalId)
  if (portal === undefined) {
    throw new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'portal does not belong to event', {
      eventId,
      portalId,
    })
  }
  return portal
}

/**
 * The `order` a newly created or duplicated portal takes: last, and never a tie.
 *
 * One past the HIGHEST order in use, not `portals.length`, and the difference is a real
 * defect that review caught. A delete deliberately leaves a gap (a gap is not a tie), so an
 * event whose portals ran `0, 1, 2` and lost the middle one is left holding `0, 2` with a
 * length of 2, and the next create would land on 2 as well. Two portals sharing a number
 * make a contact's portal depend on the tie-break rather than on the order the organizer
 * arranged, which is the one thing `order` exists to decide (`match.ts`).
 *
 * It does not close the race between two concurrent creates, and nothing here can: Airtable
 * has no compare-and-swap, so both would read the same maximum. The tie-break in `match.ts`
 * is deterministic, and the next reorder renumbers densely, so the outcome is a stable order
 * the organizer did not choose rather than an unstable one. Worth knowing, not worth a
 * Durable Object.
 */
export function nextPortalOrder(portals: readonly Portal[]): number {
  return portals.reduce((highest, portal) => Math.max(highest, portal.order), -1) + 1
}

/**
 * The full portal order a reorder should write, built rather than trusted.
 *
 * Four corrections, and every one of them is a payload the client can legitimately send:
 *
 *   - The default is placed first whatever position it arrived in. An organizer dragging
 *     past a pinned row made a UI mistake, and a drag is not a request worth rejecting, so
 *     it is corrected silently instead of erroring.
 *   - An id repeated in the payload keeps its first position. Two positions for one row
 *     means the last patch in the batch wins, which is a renumber decided by array order.
 *   - Portals the payload left out are appended in their current order, so a partial payload
 *     cannot leave a row holding a number another row has just been given. Ties are the
 *     failure this whole function exists to prevent.
 *   - An id belonging to no portal on this event is dropped HERE only because the caller has
 *     already refused it (`requireOwnPortal`). Writing a plausible order off a payload that
 *     was wrong about which conference it described is worse than refusing it.
 *
 * The result is consumed by `reorderPortals`, which renumbers from 0 in the order given, so
 * position in this array IS the `order` column.
 */
export function pinnedPortalOrder(
  portals: readonly Portal[],
  fallback: Portal,
  requested: readonly RecordId[],
): readonly RecordId[] {
  const known = new Set(portals.map((portal) => portal.id))
  const wanted = new Set(
    requested.filter((portalId) => portalId !== fallback.id && known.has(portalId)),
  )
  const omitted = portals
    .filter((portal) => !portal.isDefault && !wanted.has(portal.id))
    .map((portal) => portal.id)

  return [fallback.id, ...wanted, ...omitted]
}

/**
 * An `AppError` carries a message written for a human, so it is shown. Anything else is a
 * genuine fault and is re-thrown, so it reaches the error boundary and the logs rather than
 * being reported to an organizer as if their input were at fault.
 */
export function portalActionFailure(error: unknown): PortalActionResult {
  if (isAppError(error)) return { ok: false, error: error.message }
  throw error
}

/** Why a second write failed, kept for the log line rather than shown to an organizer. */
export function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
