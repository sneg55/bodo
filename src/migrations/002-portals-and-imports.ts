// Migration 002: Portals, the PortalItems link that points at one, and ImportRuns.
//
// A separate file rather than an edit to 001, per src/migrations/README.md: a migration
// that has been applied to a base somebody else has is never edited, because a base built
// from this directory in order has to match a base built from it a month ago. `schema.ts`
// folds the two into one declaration, so `PortalItems` appearing in both files is one
// table with one primary field, not two creates.
//
// What this adds and why it could not wait (BUILD_SPEC 5.0c, 5.0e):
//
//   - `Portals`. The first draft of §5.0c assumed one portal per event. The vendor's help
//     centre documents many, with filter-based first-match-wins assignment over an ordered
//     list, and that is a schema decision rather than a layout one. Adding it later means
//     migrating every PortalItems row.
//   - `PortalItems.portal`. Uniqueness moves from (event, item) to (portal, item), because
//     "Pages can be assigned to more than one portal". The `event` link STAYS: both sides
//     of the join carry an event and only one of them is filtered by the read, which is
//     the check src/features/resources/pages.ts already makes.
//   - `ImportRuns`. One row per inbound run, and the row is the resume point.
//
// Two things are deliberately absent. `ImportRuns` has no credential column, so a
// Sessionboard organization token is read for the duration of a run and stored nowhere.
// And no field here is a uniqueness constraint, because Airtable has no unique index:
// (portal, item) is enforced in `savePortalItems`, exactly as §3's other eight are.

import {
  checkboxField,
  dateTimeField,
  link,
  longText,
  numberField,
  select,
  type TableSpec,
  text,
} from '@/migrations/schema-types'
import { COL, TABLES } from '@/services/airtable/tables'
import { IMPORT_PHASES, IMPORT_SOURCES, IMPORT_STATUSES } from '@/types/imports'
import { PORTAL_KINDS } from '@/types/portals'

/**
 * Leads with `name`, which is both the primary field and the only column an organizer
 * types. `order` could not lead: `checkPrimary` in diff.ts allows a number, but the list
 * screen is the one place a portal is identified, and a base whose primary column reads
 * `0, 1, 2` is unreadable in Airtable itself.
 *
 * `isDefault` is a checkbox and not a link from Events, because exactly one row per event
 * carries it and the WRITE path is what enforces that (`savePortal` refuses a save leaving
 * an event with none or two). A link would let Airtable hold the invariant only when
 * somebody remembered to update both sides.
 */
const portals: TableSpec = {
  name: TABLES.portals,
  fields: [
    text(COL.name),
    link(COL.event, TABLES.events),
    // `groups` is in the vocabulary because it is in the vendor's. Nothing writes it:
    // the sponsors/exhibitors module behind it is waived.
    select(COL.kind, [...PORTAL_KINDS]),
    checkboxField(COL.isDefault),
    numberField(COL.order),
    // The contact-type and predicate set, as one blob. Not columns: the rule list is
    // variable-length, and Airtable cannot express "three predicates" without three
    // tables' worth of rows for something only this feature reads.
    longText(COL.filterJson),
    longText(COL.welcomeMessage),
    checkboxField(COL.alwaysShowTasks),
    checkboxField(COL.manageProfile),
  ],
}

/**
 * The one new field on an existing table.
 *
 * Declared as a table with a single field, which `planSchema` handles correctly for an
 * existing base (an unknown field is queued as an add) and which `mergeTableSpecs` folds
 * into 001's declaration for a fresh one, so the primary field stays `order` either way.
 */
const portalItems: TableSpec = {
  name: TABLES.portalItems,
  fields: [link(COL.portal, TABLES.portals)],
}

/**
 * One import run, and the row is what a resumed run reads to know where it got to.
 *
 * `counts` and `needsEmailJson` are blobs for the same reason `filterJson` is: both are
 * variable-length, both are read by one screen, and neither is ever filtered on.
 *
 * `leaseHolder` and `leaseExpiresAt` mirror EmailOutbox exactly, and carry the same
 * warning: writing them acquires nothing. Airtable has no compare-and-swap, so two callers
 * can both write and both believe they won. `claimOnce()` and its Durable Object are the
 * lock; these columns only record what it decided.
 */
const importRuns: TableSpec = {
  name: TABLES.importRuns,
  fields: [
    // The far side's identity: a Sessionize endpoint id, a Sessionboard region plus event
    // id, or an Accelevents event url. Never a credential.
    text(COL.sourceRef),
    link(COL.event, TABLES.events),
    select(COL.source, [...IMPORT_SOURCES]),
    select(COL.status, [...IMPORT_STATUSES]),
    select(COL.phase, [...IMPORT_PHASES]),
    longText(COL.mappingJson),
    longText(COL.counts),
    longText(COL.needsEmailJson),
    text(COL.leaseHolder),
    dateTimeField(COL.leaseExpiresAt),
    text(COL.error),
    dateTimeField(COL.startedAt),
    dateTimeField(COL.finishedAt),
  ],
}

export const MIGRATION_002: readonly TableSpec[] = [portals, portalItems, importRuns]
