// Fixtures shared by the two Portals write test files.
//
// Here rather than in either file because both of them assert against the SAME event: one
// covers the portal rows (create, edit, delete, duplicate, reorder) and one covers the
// content rows (`savePortalItems`), and a portal shaped differently in the two would let a
// change pass one file while breaking the other. The DAL mocks stay in each file, because
// `vi.mock` is hoisted per module and cannot be handed over from here.

import { EMPTY_PORTAL_FILTERS, type Portal, type PortalFilters } from '@/types/portals'
import type { PortalItem } from '@/types/resources'

export const EVENT = 'recEvent1'

export function portal(over: Partial<Portal> & { id: string }): Portal {
  return {
    eventId: EVENT,
    name: 'Portal',
    kind: 'contacts',
    isDefault: false,
    order: 1,
    filters: EMPTY_PORTAL_FILTERS,
    alwaysShowTasks: false,
    manageProfile: false,
    ...over,
  }
}

/** The row every contact falls back to. Created with the event, pinned at order 0. */
export const FALLBACK = portal({
  id: 'recDefault',
  name: 'Speaker Portal',
  isDefault: true,
  order: 0,
})

export const CUSTOM = portal({ id: 'recCustom', name: 'Moderators', order: 1 })

/** A real filter set, so a copy carrying it can be told from a copy that dropped it. */
export const TRACK_FILTER: PortalFilters = {
  contactTypes: ['moderator'],
  rules: [{ field: 'track', operator: 'is', values: ['recTrack1'] }],
}

/** A PortalItems row. `portalId` left off is the pre-5.0c migration state, not an oversight. */
export function item(over: Partial<PortalItem> & { id: string }): PortalItem {
  return { eventId: EVENT, itemType: 'task', enabled: true, order: 0, ...over }
}
