// The mapper for Portals. BUILD_SPEC 5.0c.
//
// Its own file rather than more of mapping-resources.ts, which owns the two tables a
// portal's CONTENT hangs off. This one is the container: the row an event has many of, one
// of them default, whose `order` and `filterJson` decide which contact lands where.
//
// The three traps mapping-resources.ts already absorbs apply unchanged (a link is an array,
// a blank field is an absent key, a default is only safe when being wrong about it is
// visible), and this table adds one of its own that governs every default below.
//
// That one: a portal is never READ by a speaker. It is read by the matcher, which walks the
// event's portals in `order` and takes the first whose filters the contact satisfies. So a
// default that is wrong here does not render something odd on a page an organizer is looking
// at; it silently moves people between portals, and both portals look correct afterwards.
// Every fallback below is therefore chosen so that being wrong about it pushes a contact
// TOWARDS the default portal, which is where they would have been with no custom portal at
// all, and never away from it into a portal nobody meant them to see.

import {
  type AirtableRecord,
  checkbox,
  choiceOr,
  jsonBlob,
  numberOr,
  optionalText,
  requiredLink,
  text,
  view,
} from '@/services/airtable/records'
import { portalFiltersSchema } from '@/services/airtable/schemas'
import { COL, TABLES } from '@/services/airtable/tables'
import { EMPTY_PORTAL_FILTERS, PORTAL_KINDS, type Portal } from '@/types/portals'

export function mapPortal(record: AirtableRecord): Portal {
  const source = view(TABLES.portals, record)
  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    // Required, and the only required text on the row. The list screen is the ONE place a
    // portal is identified: there is no slug, no code, and no public URL carrying its name,
    // so a nameless row is a line an organizer cannot tell from the line above it while
    // dragging the order that decides who lands where. Refusing to read it is the only way
    // that stays visible.
    name: text(source, COL.name),
    // `contacts` on a blank cell, because it is the only kind bodo writes: the groups module
    // is waived (§5.0b renders its tiles disabled), so a row created directly in Airtable
    // with the select left empty is a contacts portal that somebody forgot to finish. The
    // other reading would hide the row from every contacts query and leave the organizer
    // looking at a portal that matches nobody with no field on screen explaining why.
    kind: choiceOr(source, COL.kind, PORTAL_KINDS, 'contacts'),
    // Blank reads as not-default, which is what an Airtable checkbox means anyway. Safe
    // because the write path is what holds "exactly one default per event": a row that lost
    // the box leaves the event with none, `savePortal` refuses the next save until it is
    // fixed, and the matcher falls through to nothing rather than handing every unmatched
    // contact to a portal that was only accidentally marked default.
    isDefault: checkbox(source, COL.isDefault),
    // 0 on a blank cell, so the row sorts FIRST rather than vanishing. Being wrong here is
    // recoverable in one drag and stays visible while it is wrong, whereas dropping the row
    // or sorting it last would hide a portal whose filters are still claiming contacts.
    order: numberOr(source, COL.order, 0),
    // No filters on an empty column, which claims nobody. See the schema's own header for
    // why a malformed blob lands here too instead of failing the read.
    filters: jsonBlob(source, COL.filterJson, portalFiltersSchema, EMPTY_PORTAL_FILTERS),
    // Optional, and most portals have none: absent renders no welcome block at all, which
    // is a different thing from an empty rich-text document and has to stay different.
    welcomeMessage: optionalText(source, COL.welcomeMessage),
    // Both blank-as-false, and both are additive permissions rather than restrictions, so
    // being wrong about them shows a speaker less than intended rather than more. The
    // opposite default would let a row created in Airtable expose the profile editor on a
    // portal whose organizer never turned it on.
    alwaysShowTasks: checkbox(source, COL.alwaysShowTasks),
    manageProfile: checkbox(source, COL.manageProfile),
  }
}
