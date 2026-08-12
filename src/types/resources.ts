// Resource / wiki pages and the PortalItems row that publishes one. SPEC.md R8,
// BUILD_SPEC 5.8.
//
// Here rather than in types/domain.ts for the same reason types/forms.ts is: domain.ts
// is at its line limit, and these two types are read by one feature plus its DAL slice.
// The precedent is `@/types/forms`, which the builder, the wizard and the server-side
// re-validation all import without going through domain.ts.

import type { RecordId } from '@/types/domain'

/**
 * One resource page in the speaker portal.
 *
 * `embedHtml` is organizer-authored markup and it is NOT sanitized anywhere in this
 * codebase. It is rendered only inside a sandboxed iframe that is denied
 * `allow-same-origin`, so it executes in an opaque origin with no access to the app's
 * DOM, cookies or storage. `@/features/resources/embed` carries the full reasoning and
 * the limits. Nothing may put this field through `dangerouslySetInnerHTML`.
 *
 * `visibility` is the schema's own vocabulary (`RESOURCE_VISIBILITIES` in
 * src/migrations/tables-portal.ts). Both values are readable by a signed-in speaker:
 * `public` is a superset meaning "also servable without a session", and nothing serves
 * that yet, so treating it as portal-visible is the reading that shows an organizer
 * their page rather than silently hiding it. What decides whether a speaker sees the
 * page at all is the PortalItems row below.
 */
export type Resource = {
  id: RecordId
  eventId: RecordId
  title: string
  slug: string
  bodyMarkdown?: string
  embedHtml?: string
  visibility: 'portal' | 'public'
  order: number
}

export const PORTAL_ITEM_TYPES = ['task', 'form', 'file_request', 'resource'] as const
export type PortalItemType = (typeof PORTAL_ITEM_TYPES)[number]

/**
 * The ordering and the enabled flag for one portal surface.
 *
 * Exactly one of the four links is set and `itemType` names which, which is why they
 * are four nullable links rather than four `enabled` columns spread across four tables:
 * only a row can carry an ordering across kinds.
 *
 * A resource with no PortalItems row, or one whose row is disabled, is a draft. The
 * organizer can edit it and no speaker can reach it, which is the only "not visible to
 * this speaker" state the schema can express, since both `visibility` values are
 * portal-readable.
 */
export type PortalItem = {
  id: RecordId
  eventId: RecordId
  /**
   * Which portal exposes it. Optional, and the optionality is a migration state rather
   * than a design: rows written before BUILD_SPEC 5.0c added multiple portals carry no
   * link, and `savePortalItems` resolves those to the event's default portal. A reader
   * that treats absent as "the default portal" is correct in every case.
   */
  portalId?: RecordId
  itemType: PortalItemType
  taskId?: RecordId
  formId?: RecordId
  fileRequestId?: RecordId
  resourceId?: RecordId
  enabled: boolean
  order: number
}
