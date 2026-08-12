// Mappers for Resources and PortalItems. SPEC.md R8, BUILD_SPEC 5.8.
//
// Its own file rather than more of mapping-portal.ts, which is at 200-odd lines and is
// being edited concurrently. Same three traps that file absorbs apply here (a link is an
// array, a blank field is an absent key, a default is only safe when being wrong about it
// is visible), plus one that is specific to these two tables.
//
// That one: `PortalItems.enabled` decides whether a speaker can see a resource page, and
// an Airtable checkbox reads as `false` when it is blank. So an unchecked box and a
// never-touched box are the same value, and they mean the same thing here on purpose: not
// published. Defaulting the other way would publish an organizer's unfinished venue page
// the moment its row was created.
//
// `Resources.visibility` defaults to `portal`, which is the narrower of the two values.
// `public` is a superset (types/resources.ts), so reading a blank cell as `public` would
// widen an organizer's intent on the strength of an empty field.

import {
  type AirtableRecord,
  checkbox,
  choiceOr,
  numberOr,
  optionalLink,
  optionalText,
  requiredChoice,
  requiredLink,
  text,
  view,
} from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import { PORTAL_ITEM_TYPES, type PortalItem, type Resource } from '@/types/resources'

const RESOURCE_VISIBILITIES = [
  'portal',
  'public',
] as const satisfies readonly Resource['visibility'][]

export function mapResource(record: AirtableRecord): Resource {
  const source = view(TABLES.resources, record)
  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    // Required: a resource with no title has nothing to render in a nav or a heading.
    title: text(source, COL.title),
    // Required for the same reason and one more: the slug IS the URL, so a blank one
    // makes the page unreachable while still occupying the list.
    slug: text(source, COL.slug),
    bodyMarkdown: optionalText(source, COL.bodyMarkdown),
    // Optional, and most resources have none. Raw organizer markup: it is rendered only
    // inside a sandboxed iframe (@/features/resources/embed) and never sanitized here,
    // because sanitizing on read would silently change what the organizer stored.
    embedHtml: optionalText(source, COL.embedHtml),
    visibility: choiceOr(source, COL.visibility, RESOURCE_VISIBILITIES, 'portal'),
    order: numberOr(source, COL.order, 0),
  }
}

export function mapPortalItem(record: AirtableRecord): PortalItem {
  const source = view(TABLES.portalItems, record)
  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    // Optional, and an absent link is NOT an error: every row written before BUILD_SPEC
    // 5.0c added multiple portals carries none, and those resolve to the event's default
    // portal at read time. `requiredLink` here would make the resources page of every event
    // in the base unreadable the moment the column was added.
    portalId: optionalLink(source, COL.portal),
    // No default. `itemType` names which of the four links is the real one, so reading a
    // blank one as `resource` would make a task row publish a resource page.
    itemType: requiredChoice(source, COL.itemType, PORTAL_ITEM_TYPES),
    taskId: optionalLink(source, COL.task),
    formId: optionalLink(source, COL.form),
    fileRequestId: optionalLink(source, COL.fileRequest),
    resourceId: optionalLink(source, COL.resource),
    // Blank means not published. See the header.
    enabled: checkbox(source, COL.enabled),
    order: numberOr(source, COL.order, 0),
  }
}
